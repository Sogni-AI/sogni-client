const { SogniClient } = require('@sogni-ai/sogni-client');
const express = require('express');
const bodyParser = require('body-parser');

const USERNAME = 'your-username';
const PASSWORD = 'your-password';
const APP_ID = 'your-app-id';

let client;
SogniClient.createInstance({
  appId: APP_ID
})
  .then(async (clientInstance) => {
    client = clientInstance;
    await client.account.login(USERNAME, PASSWORD);
    await client.projects.waitForModels();
    console.log('SogniClient instance created');
    app.listen(3000);
  })
  .catch((e) => {
    console.log('Failed to create SogniClient instance:', e);
    console.error(e);
    process.exit(1);
  });

const app = express();

app.use(express.static('public'));

app.use(bodyParser.json());

app.get('/', function (req, res) {
  res.sendFile(__dirname + '/index.html');
});

app.post('/api/generate', async function (req, res) {
  const { prompt, style } = req.body;
  try {
    const project = await client.projects.create({
      modelId: 'flux1-schnell-fp8',
      positivePrompt: prompt,
      stylePrompt: style,
      steps: 4,
      guidance: 1,
      numberOfImages: 1
    });
    const imageUrls = await project.waitForCompletion();
    res.send({ url: imageUrls[0] });
  } catch (e) {
    console.error(e);
    res.status(500).send('Failed to generate image');
  }
});
