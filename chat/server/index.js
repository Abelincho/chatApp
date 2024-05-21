import express from 'express'
import logger from 'morgan'
import { Server } from 'socket.io'
import { createServer } from 'node:http'
import { createClient } from '@libsql/client'
import { v4 as uuidv4 } from 'uuid';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({path: path.resolve(__dirname, '../../.env')});

const port = process.env.PORT ?? 3000

const app = express()
const server = createServer(app)
const io = new Server(server, {
    connectionStateRecovery: {
        maxDisconnectionDuration: 2 * 60 * 1000,
    }
})
const db = createClient({
    url: process.env.TURSO_DATABASE_URL,
    authToken:  process.env.TURSO_AUTH_TOKEN
    
})


try {
    console.log('Intentando eliminar la tabla "messages"');
    await db.execute(`DROP TABLE IF EXISTS messages`);

    console.log('Intentando crear la tabla "messages"');
    await db.execute(`
        CREATE TABLE IF NOT EXISTS messages(
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            content TEXT,
            id_user TEXT
        );
    `);

    console.log('Tabla "messages" creada con éxito');
} catch (error) {
    console.error('Error en la creación o eliminación de tablas:', error);
}



io.on('connection', async (socket) => {
    const userId = uuidv4();

    socket.userId = userId;
    socket.emit('connection succes', {uid: socket.userId});
    console.log(`a user ${userId} has connected!`);

    // console.log('---EJEMPLO DE SOCKET---');
    // console.log(socket);
    // console.log('-----------------------');
    
    socket.on('disconnect', () => {
        console.log(`user ${socket.userId} has disconnected`);
    })

    socket.on('chat message', async (msg) => {
        let result
        try{
            result = await db.execute({
                sql: 'INSERT INTO messages (content, id_user) VALUES(:msg, :uid)',
                args: {msg, uid: socket.userId}
            });
        }catch(e){
            console.error(e);
            return;
        }
        io.emit('chat message', {msg, msgId: result.lastInsertRowid.toString(), sender: socket.userId})
    })

    if(!socket.recovered){//se ha conectado un cli y no se ha recuperado de una desconexion -> recuperamos todos los mensajes 
        try{
            const results = await db.execute({
                sql: 'SELECT id, content, id_user FROM messages WHERE id > ?',
                args: [socket.handshake.auth.serverOffset ?? 0]
            })
            results.rows.forEach(row => {
                socket.emit('chat message', {msg: row.content, msgId: row.id.toString(), sender: row.id_user});
            })
        }catch(e){
            console.error(e);
        }
    }
})

app.use(logger('dev'))

app.get('/', (req, res) => {
    res.sendFile(path.resolve(__dirname, './public/index.html'))
})

server.listen(port, () =>{
    console.log(`Server is running on port ${port}`);
    console.log('http://localhost:3000');
})

