import express from 'express';
 
const app = express();
const port = 3000;

app.use((req, res, next) => {
    // Define the headers you require
    const requiredHeaders = ["content-type"];
  
    // Check if all required headers are present
    const areHeadersPresent = requiredHeaders.every(header => req.headers[header]);

    const bearerInvalid = (`Bearer invalid` === req.headers['authorization']);
  
    if (!areHeadersPresent) {
      // If not, send an error response
      return res.status(400).json({ error: 'Missing required headers', headers: req.headers});
    }

    if (areHeadersPresent && bearerInvalid ){
      // If not, send an error response
      return res.status(400).json({ data: [{ attributes: { name: 'not_dataset_description.json' }, id: 'osfstorage/123' }]});
    }
  
    // If all required headers are present, proceed to the next middleware
    next();
  });

app.get('/endpoint', async (req, res) => {

  const result = { data: [{ attributes: { name: 'dataset_description.json' }, id: 'osfstorage/123' }] };
  res.json(result);
});

app.put('/endpoint', async (req, res) => {
  // Simulate successful OSF file upload (Waterbutler returns 201)
  res.status(201).json({ data: { attributes: { name: req.query.name || 'uploaded.json' } } });
});

const startServer = (): Promise<ReturnType<typeof app.listen>> => {
    return new Promise((resolve) => {
      const server = app.listen(port, () => {
        console.log(`Server running at http://localhost:${port}`);
        resolve(server);
      });
    });
  };

  export { startServer };