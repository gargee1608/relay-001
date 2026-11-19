import 'dotenv/config';
import express from 'express';
import http from 'node:http';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import mysql from 'mysql2/promise';
import { Server as SocketServer } from 'socket.io';
import { AccessToken, RoomServiceClient } from 'livekit-server-sdk';

const app = express();
const server = http.createServer(app);
const io = new SocketServer(server, { cors: { origin: true, credentials: true } });
app.use(express.json());
app.use(express.static('public'));
const pool = mysql.createPool({host:process.env.DB_HOST,user:process.env.DB_USER,password:process.env.DB_PASSWORD,database:process.env.DB_NAME,waitForConnections:true,connectionLimit:10});
const lk = new RoomServiceClient(process.env.LIVEKIT_URL, process.env.LIVEKIT_API_KEY, process.env.LIVEKIT_API_SECRET);
const floor = new Map(); // room -> { identity, since, timer }
const MAX_TALK_MS = 60000;
const sign = user => jwt.sign({id:user.id,username:user.username,role:user.role},process.env.JWT_SECRET,{expiresIn:'12h'});
const auth = (req,res,next) => { try { req.user=jwt.verify((req.headers.authorization||'').replace(/^Bearer /,''),process.env.JWT_SECRET); next(); } catch { res.status(401).json({error:'Authentication required'}); } };

async function init(){
 await pool.query(`CREATE TABLE IF NOT EXISTS users(id BIGINT PRIMARY KEY AUTO_INCREMENT,username VARCHAR(60) UNIQUE NOT NULL,password_hash VARCHAR(255) NOT NULL,role ENUM('admin','user') DEFAULT 'user',created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`);
 await pool.query(`CREATE TABLE IF NOT EXISTS rooms(id INT PRIMARY KEY AUTO_INCREMENT,room_key VARCHAR(60) UNIQUE NOT NULL,name VARCHAR(100) NOT NULL,password_hash VARCHAR(255) NULL,created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`);
 const [admins]=await pool.query('SELECT id FROM users WHERE username=?',[process.env.ADMIN_USERNAME]);
 if(!admins.length){const hash=await bcrypt.hash(process.env.ADMIN_PASSWORD,12);await pool.query('INSERT INTO users(username,password_hash,role) VALUES(?,?,\'admin\')',[process.env.ADMIN_USERNAME,hash]);}
 const seeds=[['ops','Channel 1 – Operations'],['security','Channel 2 – Security'],['support','Channel 3 – Technical Support'],['management','Channel 4 – Management'],['emergency','Channel 5 – Emergency']];
 for(const [key,name] of seeds) await pool.query('INSERT IGNORE INTO rooms(room_key,name) VALUES(?,?)',[key,name]);
}
app.get('/api/health',async(_req,res)=>res.json({ok:true,service:'private-virtual-radio'}));
app.post('/api/register',async(req,res)=>{try{const {username,password}=req.body||{};if(!/^[a-zA-Z0-9_-]{3,30}$/.test(username||'')||(password||'').length<10)return res.status(400).json({error:'Username must be 3–30 characters; password at least 10 characters'});const hash=await bcrypt.hash(password,12);const [r]=await pool.query('INSERT INTO users(username,password_hash) VALUES(?,?)',[username,hash]);res.json({token:sign({id:r.insertId,username,role:'user'}),username,role:'user'});}catch(e){res.status(409).json({error:'Username already exists'});}});
app.post('/api/login',async(req,res)=>{const {username,password}=req.body||{};const [rows]=await pool.query('SELECT * FROM users WHERE username=?',[username||'']);if(!rows.length||!await bcrypt.compare(password||'',rows[0].password_hash))return res.status(401).json({error:'Invalid username or password'});const u=rows[0];res.json({token:sign(u),username:u.username,role:u.role});});
app.get('/api/rooms',auth,async(_req,res)=>{const [rows]=await pool.query('SELECT room_key,name FROM rooms ORDER BY id');res.json(rows);});
app.post('/api/rooms/:key/join',auth,async(req,res)=>{const [rows]=await pool.query('SELECT * FROM rooms WHERE room_key=?',[req.params.key]);if(!rows.length)return res.status(404).json({error:'Room not found'});if(rows[0].password_hash&&!await bcrypt.compare(req.body.password||'',rows[0].password_hash))return res.status(403).json({error:'Incorrect room password'});const room=rows[0].room_key;const identity=String(req.user.id);const at=new AccessToken(process.env.LIVEKIT_API_KEY,process.env.LIVEKIT_API_SECRET,{identity,name:req.user.username,ttl:'2h'});at.addGrant({room,roomJoin:true,canSubscribe:true,canPublish:false,canPublishData:false});res.json({token:await at.toJwt(),url:process.env.PUBLIC_LIVEKIT_URL,room,identity});});
app.post('/api/admin/rooms/:key/password',auth,async(req,res)=>{if(req.user.role!=='admin')return res.sendStatus(403);const p=req.body.password||'';if(p.length<10)return res.status(400).json({error:'Password must be at least 10 characters'});await pool.query('UPDATE rooms SET password_hash=? WHERE room_key=?',[await bcrypt.hash(p,12),req.params.key]);res.json({ok:true});});
async function release(room,reason='released'){const current=floor.get(room);if(!current)return;clearTimeout(current.timer);floor.delete(room);try{await lk.updateParticipant(room,current.identity,{canPublish:false,canPublishData:false});}catch{}io.to(room).emit('floor:free',{room,reason});}
io.use((socket,next)=>{try{socket.user=jwt.verify(socket.handshake.auth?.token,process.env.JWT_SECRET);next();}catch{next(new Error('unauthorized'));}});
io.on('connection',socket=>{
 socket.on('room:watch',async({room},ack=()=>{})=>{const [r]=await pool.query('SELECT room_key FROM rooms WHERE room_key=?',[room]);if(!r.length)return ack({ok:false,error:'Unknown room'});socket.join(room);ack({ok:true,activeSpeaker:floor.get(room)?.identity||null});});
 socket.on('ptt:request',async({room},ack=()=>{})=>{try{if(!socket.rooms.has(room))return ack({ok:false,error:'Join room first'});if(floor.has(room))return ack({ok:false,error:'Channel busy',speaker:floor.get(room).identity});const identity=String(socket.user.id);floor.set(room,{identity,since:Date.now(),timer:setTimeout(()=>release(room,'maximum talk time reached'),MAX_TALK_MS)});try{await lk.updateParticipant(room,identity,{canPublish:true,canPublishData:false});}catch(e){floor.delete(room);return ack({ok:false,error:'Join the audio room before requesting PTT'});}io.to(room).emit('floor:busy',{room,identity,username:socket.user.username});ack({ok:true,granted:true});}catch{ack({ok:false,error:'PTT request failed'});}});
 socket.on('ptt:release',async({room})=>{if(floor.get(room)?.identity===String(socket.user.id))await release(room);});
 socket.on('disconnect',async()=>{for(const [room,f] of floor)if(f.identity===String(socket.user.id))await release(room,'speaker disconnected');});
});
const port=Number(process.env.PORT||3000);init().then(()=>server.listen(port,'0.0.0.0',()=>console.log(`Virtual Radio API listening on ${port}`))).catch(e=>{console.error(e);process.exit(1)});
