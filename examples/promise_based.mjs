import * as fs from 'node:fs';
import { pipeline } from 'node:stream';
import { promisify } from 'node:util';
import { SogniClient } from '@sogni-ai/sogni-client';

const USERNAME = 'your-username';
const PASSWORD = 'your-password';

const streamPipeline = promisify(pipeline);

//Make sure images directory exists
if (!fs.existsSync('./images')) {
  fs.mkdirSync('./images');
}

async function downloadImage(url) {
  const parsedUrl = new URL(url);
  const fileName = parsedUrl.pathname.split('/').pop();
  const savePath = `./images/${fileName}`;
  console.log('Downloading image:', fileName);
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download image: ${response.statusText}`);
  }
  await streamPipeline(response.body, fs.createWriteStream(savePath));
}

const client = await SogniClient.createInstance({
  appId: `${USERNAME}-image-generator`,
  network: 'relaxed' // or 'fast' for faster but more expensive processing
});

await client.account.login(USERNAME, PASSWORD);

const models = await client.projects.waitForModels();

const mostPopularModel = models.reduce((a, b) => (a.workerCount > b.workerCount ? a : b));

console.log('Using model:', mostPopularModel.name);
const project = await client.projects.create({
  modelId: mostPopularModel.id,
  steps: 20,
  guidance: 7.5,
  positivePrompt: 'A cat wearing a hat',
  negativePrompt:
    'malformation, bad anatomy, bad hands, missing fingers, cropped, low quality, bad quality, jpeg artifacts, watermark',
  stylePrompt: 'anime',
  numberOfImages: 4
});

project.on('progress', (progress) => {
  console.log('Project progress:', progress);
});

const imageUrls = await project.waitForCompletion();

console.log('Project completed');

for (const imageUrl of imageUrls) {
  await downloadImage(imageUrl);
}

await client.account.logout();
