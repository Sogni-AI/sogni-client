const { SogniClient } = require('@sogni-ai/sogni-client');
const express = require('express');
const bodyParser = require('body-parser');

const USERNAME = 'your-username';
const PASSWORD = 'your-password';
const APP_ID = 'your-app-id';

let sogni;
SogniClient.createInstance({
  appId: APP_ID
})
  .then(async (clientInstance) => {
    sogni = clientInstance;
    await sogni.account.login(USERNAME, PASSWORD);
    await sogni.projects.waitForModels();
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
    const project = await sogni.projects.create({
      type: 'image',
      modelId: 'flux1-schnell-fp8',
      positivePrompt: prompt,
      stylePrompt: style,
      steps: 4,
      guidance: 1,
      numberOfMedia: 1
    });
    const imageUrls = await project.waitForCompletion();
    res.send({ url: imageUrls[0] });
  } catch (e) {
    console.error(e);
    res.status(500).send('Failed to generate image');
  }
});
