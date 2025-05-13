// be sure to run `npm install` then `npm run build` to use this example with your target version of the SDK
const { SogniClient } = require('../dist');

const USERNAME = 'your-username';
const PASSWORD = 'your-password';

const config = {
  appId: `${USERNAME}-image-generator`
};

async function getClient() {
  const client = await SogniClient.createInstance(config);
  await client.account.login(USERNAME, PASSWORD);
  await client.projects.waitForModels();
  return client;
}

getClient()
  .then(async (client) => {
    // Find model that has the most workers
    const mostPopularModel = client.projects.availableModels.reduce((a, b) =>
      a.workerCount > b.workerCount ? a : b
    );
    console.log('Most popular model:', mostPopularModel);
    // Create a project using the most popular model
    const project = await client.projects.create({
      modelId: mostPopularModel.id,
      steps: 20,
      guidance: 7.5,
      positivePrompt: 'A cat wearing a hat',
      negativePrompt:
        'malformation, bad anatomy, bad hands, missing fingers, cropped, low quality, bad quality, jpeg artifacts, watermark',
      stylePrompt: 'anime',
      numberOfPreviews: 2,
      numberOfImages: 2
    });

    // Receive project completion percentage in real-time
    project.on('progress', (progress) => {
      console.log('Project progress:', progress);
    });

    // Listen for individual project events: queued, completed, failed, error
    client.projects.on('project', (event) => {
      console.log(`Project event: "${event.type}" payload:`, event);
      if (['completed', 'failed', 'error'].includes(event.type)) {
        console.log('Project completed or failed, exiting...');
        // await client.account.logout();
        process.exit(0);
      }
    });

    // Listen for individual job events: initiating, started, progress, preview, completed, failed, error
    client.projects.on('job', (event) => {
      console.log(`Job event: "${event.type}" payload:`, event);
    });
  })
  .catch((error) => {
    console.error('Error initializing Sogni API client', error);
    setTimeout(() => {
      process.exit(1);
    }, 100);
  });
