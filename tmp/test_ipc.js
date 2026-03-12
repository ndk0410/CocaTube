const net = require('net');

const pipePath = '\\\\.\\pipe\\discord-ipc-0';

console.log(`Connecting to ${pipePath}...`);

const socket = net.createConnection(pipePath, () => {
    console.log('CONNECTED to Discord IPC pipe!');
    
    // Discord IPC handshake (opcode 0: HANDSHAKE, version 1)
    const clientId = '1216346215017254952'; // Generic ID
    const payload = JSON.stringify({ v: 1, client_id: clientId });
    const buffer = Buffer.alloc(8 + payload.length);
    
    buffer.writeUInt32LE(0, 0); // Opcode 0
    buffer.writeUInt32LE(payload.length, 4); // Length
    buffer.write(payload, 8); // Data
    
    console.log('Sending handshake...');
    socket.write(buffer);
});

socket.on('data', (data) => {
    console.log('RECEIVED data from Discord:');
    const opcode = data.readUInt32LE(0);
    const length = data.readUInt32LE(4);
    const body = data.slice(8).toString();
    console.log(`Opcode: ${opcode}, Length: ${length}`);
    console.log('Body:', body);
    
    if (opcode === 1) { // FRAME (Response)
        console.log('Handshake SUCCESSFUL!');
    }
    socket.end();
});

socket.on('error', (err) => {
    console.error('CONNECTION ERROR:', err.message);
});

socket.on('end', () => {
    console.log('Disconnected from pipe.');
});

// Timeout
setTimeout(() => {
    if (socket.connecting) {
        console.log('Connection TIMEOUT.');
        socket.destroy();
    }
}, 5000);
