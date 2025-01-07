const express = require('express');
const AWS = require('aws-sdk');
const path = require('path');
const app = express();
const PORT = process.env.PORT || 3000;

// Middleware to parse JSON bodies
app.use(express.json());

// S3 configuration using environment variables
const s3 = new AWS.S3({
    endpoint: process.env.S3_ENDPOINT,
    accessKeyId: process.env.S3_ACCESS_KEY_ID,
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
    s3ForcePathStyle: true
});

const bucketName = process.env.S3_BUCKET_NAME;

// Function to ensure the bucket exists
const ensureBucketExists = async () => {
    try {
        const buckets = await s3.listBuckets().promise();
        if (!buckets.Buckets.some(bucket => bucket.Name === bucketName)) {
            await s3.createBucket({ Bucket: bucketName }).promise();
            console.log(`Bucket '${bucketName}' created.`);
        } else {
            console.log(`Bucket '${bucketName}' already exists.`);
        }
    } catch (error) {
        console.error('Error ensuring bucket exists:', error);
        throw error;
    }
};

// Serve the HTML file
app.get('/', async (req, res) => {
    try {
        const data = await s3.listObjectsV2({ Bucket: bucketName }).promise();
        const files = data.Contents.map(file => file.Key);

        const html = `
            <!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>S3 File Manager</title>
            </head>
            <body>
                <h1>S3 File Manager</h1>
                <form id="uploadForm" action="/files" method="POST">
                    <textarea name="text" id="text" cols="30" rows="10" placeholder="Enter file content"></textarea><br>
                    <button type="submit">Upload File</button>
                </form>
                <h2>Files in Bucket:</h2>
                <ul>
                    ${files.map(file => `<li>${file}</li>`).join('')}
                </ul>
                <script>
                    const form = document.getElementById('uploadForm');
                    form.addEventListener('submit', async (event) => {
                        event.preventDefault();
                        const text = document.getElementById('text').value;

                        const response = await fetch('/files', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ text })
                        });

                        if (response.ok) {
                            alert('File uploaded successfully!');
                            location.reload();
                        } else {
                            alert('Failed to upload file.');
                        }
                    });
                </script>
            </body>
            </html>
        `;

        res.send(html);
    } catch (error) {
        console.error('Error generating HTML page:', error);
        res.status(500).send('Error generating HTML page.');
    }
});

// POST request: Create a new file
app.post('/files', async (req, res) => {
    const { text } = req.body;

    if (!text) {
        return res.status(400).json({ error: 'Text is required in the request body.' });
    }

    const filename = `${Date.now()}.txt`;

    try {
        await s3.putObject({
            Bucket: bucketName,
            Key: filename,
            Body: text
        }).promise();

        res.status(201).json({ filename });
    } catch (error) {
        console.error('Error saving the file:', error);
        res.status(500).json({ error: 'Error saving the file.' });
    }
});

// GET request: Retrieve a file's content
app.get('/files/:filename', async (req, res) => {
    const { filename } = req.params;

    try {
        const data = await s3.getObject({
            Bucket: bucketName,
            Key: filename
        }).promise();

        res.status(200).json({ content: data.Body.toString('utf-8') });
    } catch (error) {
        if (error.code === 'NoSuchKey') {
            return res.status(404).json({ error: 'File not found.' });
        }
        console.error('Error reading the file:', error);
        res.status(500).json({ error: 'Error reading the file.' });
    }
});

// PUT request: Update a file's content
app.put('/files/:filename', async (req, res) => {
    const { filename } = req.params;
    const { text } = req.body;

    if (!text) {
        return res.status(400).json({ error: 'Text is required in the request body.' });
    }

    try {
        await s3.putObject({
            Bucket: bucketName,
            Key: filename,
            Body: text
        }).promise();

        res.status(200).json({ message: 'File updated successfully.' });
    } catch (error) {
        console.error('Error updating the file:', error);
        res.status(500).json({ error: 'Error updating the file.' });
    }
});

// DELETE request: Delete a file
app.delete('/files/:filename', async (req, res) => {
    const { filename } = req.params;

    try {
        await s3.deleteObject({
            Bucket: bucketName,
            Key: filename
        }).promise();

        res.status(200).json({ message: 'File deleted successfully.' });
    } catch (error) {
        if (error.code === 'NoSuchKey') {
            return res.status(404).json({ error: 'File not found.' });
        }
        console.error('Error deleting the file:', error);
        res.status(500).json({ error: 'Error deleting the file.' });
    }
});

// GET request: List all files in the bucket
app.get('/files', async (req, res) => {
    try {
        const data = await s3.listObjectsV2({ Bucket: bucketName }).promise();
        const files = data.Contents.map(file => file.Key);
        res.status(200).json({ files });
    } catch (error) {
        console.error('Error listing files:', error);
        res.status(500).json({ error: 'Error listing files.' });
    }
});

// Start the server
(async () => {
    try {
        await ensureBucketExists();
        app.listen(PORT, () => {
            console.log(`Server is running on http://localhost:${PORT}`);
        });
    } catch (error) {
        console.error('Failed to start the server:', error);
    }
})();
