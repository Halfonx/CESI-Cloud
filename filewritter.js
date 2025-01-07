const express = require('express');
const { S3Client, HeadBucketCommand, CreateBucketCommand, 
       PutObjectCommand, GetObjectCommand, DeleteObjectCommand, 
       ListObjectsCommand } = require('@aws-sdk/client-s3');
const bodyParser = require('body-parser');
const streamToString = require('stream-to-string');
const path = require('path');
const mysql = require('mysql2/promise');

const app = express();
const PORT = process.env.PORT || 3000;
const BUCKET_NAME = process.env.BUCKET_NAME ||'jeremy-cesi-filewritter'; // Replace with your desired bucket name

// S3 Configuration
const endpoint = process.env.S3_ENDPOINT;
const accessKeyId = process.env.S3_ACCESS_KEY_ID;
const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY;

if (!endpoint || !accessKeyId || !secretAccessKey) {
    console.error('Error: Missing S3 configuration in environment variables.');
    process.exit(1);
}

const s3 = new S3Client({
    endpoint,
    region: 'us-east-1', // Adjust region if needed
    credentials: {
        accessKeyId,
        secretAccessKey,
    },
});

// MySQL Configuration
const MYSQL_URI = process.env.MYSQL_ADDON_URI;

if (!MYSQL_URI) {
    console.error('Error: Missing MySQL configuration in environment variables.');
    process.exit(1);
}

const ensureDatabaseSetup = async () => {
    try {
        const connection = await mysql.createConnection(MYSQL_URI);
        await connection.query(`CREATE TABLE IF NOT EXISTS filewriter_metadata (
            id INT AUTO_INCREMENT PRIMARY KEY,
            tag VARCHAR(255) NOT NULL,
            filename VARCHAR(255) NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`);
        console.log('Database and table setup complete.');
        await connection.end();
    } catch (err) {
        console.error('Error setting up database:', err);
        process.exit(1);
    }
};

// Middleware to parse JSON request bodies
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));

// Ensure bucket exists
const ensureBucketExists = async () => {
    try {
        await s3.send(new HeadBucketCommand({ Bucket: BUCKET_NAME }));
        console.log(`Bucket "${BUCKET_NAME}" already exists.`);
    } catch (err) {
        if (err.$metadata && err.$metadata.httpStatusCode === 404) {
            await s3.send(new CreateBucketCommand({ Bucket: BUCKET_NAME }));
            console.log(`Bucket "${BUCKET_NAME}" created.`);
        } else {
            console.error('Error ensuring bucket exists:', err);
        }
    }
};

// POST: Create a new object with the given text and tags
app.post('/files', async (req, res) => {
    const { text, tags } = req.body;

    if (!text) {
        return res.status(400).json({ error: 'Text is required in the request body.' });
    }

    const filename = `${Date.now()}.txt`;

    try {
        await s3.send(new PutObjectCommand({
            Bucket: BUCKET_NAME,
            Key: filename,
            Body: text,
            ContentType: 'text/plain',
        }));

        const connection = await mysql.createConnection(MYSQL_URI);

        if (tags && Array.isArray(tags)) {
            for (const tag of tags) {
                await connection.query('INSERT INTO filewriter_metadata (tag, filename) VALUES (?, ?)', [tag, filename]);
            }
        } else {
            await connection.query('INSERT INTO filewriter_metadata (tag, filename) VALUES (?, ?)', [null, filename]);
        }

        await connection.end();

        res.status(201).json({ filename, tags: tags || [] });
    } catch (err) {
        console.error('Error uploading file:', err);
        res.status(500).json({ error: 'Failed to upload the file.' });
    }
});

// PUT: Update an object with new text and tags
app.put('/files/:filename', async (req, res) => {
    const { filename } = req.params;
    const { text, tags } = req.body;

    if (!text) {
        return res.status(400).json({ error: 'Text is required in the request body.' });
    }

    try {
        await s3.send(new PutObjectCommand({
            Bucket: BUCKET_NAME,
            Key: filename,
            Body: text,
            ContentType: 'text/plain',
        }));

        const connection = await mysql.createConnection(MYSQL_URI);

        if (tags && Array.isArray(tags)) {
            await connection.query('DELETE FROM filewriter_metadata WHERE filename = ?', [filename]);
            for (const tag of tags) {
                await connection.query('INSERT INTO filewriter_metadata (tag, filename) VALUES (?, ?)', [tag, filename]);
            }
        }

        await connection.end();

        res.status(200).json({ filename, tags: tags || [] });
    } catch (err) {
        console.error('Error updating file:', err);
        res.status(500).json({ error: 'Failed to update the file.' });
    }
});

// GET: Retrieve the content of an object
app.get('/files/:filename', async (req, res) => {
    const { filename } = req.params;

    try {
        const data = await s3.send(new GetObjectCommand({
            Bucket: BUCKET_NAME,
            Key: filename,
        }));

        const content = await streamToString(data.Body);

        const connection = await mysql.createConnection(MYSQL_URI);
        const [rows] = await connection.query('SELECT tag FROM filewriter_metadata WHERE filename = ?', [filename]);
        const tags = rows.map(row => row.tag);
        await connection.end();

        res.status(200).json({ content, tags });
    } catch (err) {
        if (err.$metadata && err.$metadata.httpStatusCode === 404) {
            res.status(404).json({ error: 'File not found.' });
        } else {
            console.error('Error retrieving file:', err);
            res.status(500).json({ error: 'Failed to retrieve the file.' });
        }
    }
});

// GET: Search for files by tags
app.get('/search', async (req, res) => {
    const { tags } = req.query;

    if (!tags) {
        return res.status(400).json({ error: 'Tags query parameter is required.' });
    }

    const tagList = tags.split(',');

    try {
        const connection = await mysql.createConnection(MYSQL_URI);
        const placeholders = tagList.map(() => '?').join(',');
        const [rows] = await connection.query(
            `SELECT DISTINCT filename FROM filewriter_metadata WHERE tag IN (${placeholders})`,
            tagList
        );
        await connection.end();

        const filenames = rows.map(row => row.filename);
        res.status(200).json({ filenames });
    } catch (err) {
        console.error('Error searching for files:', err);
        res.status(500).json({ error: 'Failed to search for files.' });
    }
});

// GET: List all objects with tags in the bucket
app.get('/files', async (req, res) => {
    try {
        const data = await s3.send(new ListObjectsCommand({ Bucket: BUCKET_NAME }));
        const files = data.Contents ? data.Contents.map(item => item.Key) : [];

        const connection = await mysql.createConnection(MYSQL_URI);
        const fileData = [];

        for (const filename of files) {
            const [rows] = await connection.query('SELECT tag FROM filewriter_metadata WHERE filename = ?', [filename]);
            const tags = rows.map(row => row.tag);
            fileData.push({ filename, tags });
        }

        await connection.end();

        res.status(200).json({ files: fileData });
    } catch (err) {
        console.error('Error listing files:', err);
        res.status(500).json({ error: 'Failed to list files.' });
    }
});

// DELETE: Delete an object
app.delete('/files/:filename', async (req, res) => {
    const { filename } = req.params;

    try {
        await s3.send(new DeleteObjectCommand({
            Bucket: BUCKET_NAME,
            Key: filename,
        }));

        const connection = await mysql.createConnection(MYSQL_URI);
        await connection.query('DELETE FROM filewriter_metadata WHERE filename = ?', [filename]);
        await connection.end();

        res.status(200).json({ message: 'File deleted successfully.' });
    } catch (err) {
        if (err.$metadata && err.$metadata.httpStatusCode === 404) {
            res.status(404).json({ error: 'File not found.' });
        } else {
            console.error('Error deleting file:', err);
            res.status(500).json({ error: 'Failed to delete the file.' });
        }
    }
});

// Serve HTML file for frontend
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start the server and ensure bucket exists
app.listen(PORT, async () => {
    await ensureBucketExists();
    await ensureDatabaseSetup();
    console.log(`Server is running on http://localhost:${PORT}`);
});