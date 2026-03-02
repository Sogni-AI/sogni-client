// be sure to run `npm install` then `npm run build` to use this example with your target version of the SDK
const { SogniClient } = require('../dist');

const USERNAME = 'your-username';
const PASSWORD = 'your-password';

const config = {
  appId: `${USERNAME}-image-generator`
};

async function getClient() {
  const sogni = await SogniClient.createInstance(config);
  await sogni.account.login(USERNAME, PASSWORD);
  await sogni.projects.waitForModels();
  return sogni;
}

getClient()
  .then(async (sogni) => {
    // Find model that has the most workers
    const mostPopularModel = sogni.projects.availableModels.reduce((a, b) =>
      a.workerCount > b.workerCount ? a : b
    );
    console.log('Most popular model:', mostPopularModel);
    // Create a project using the most popular model
    const project = await sogni.projects.create({
      type: 'image',
      modelId: mostPopularModel.id,
      steps: 20,
      guidance: 7.5,
      positivePrompt: 'A cat wearing a hat',
      negativePrompt:
        'malformation, bad anatomy, bad hands, missing fingers, cropped, low quality, bad quality, jpeg artifacts, watermark',
      stylePrompt: 'anime',
      numberOfPreviews: 2,
      numberOfMedia: 2,
      outputFormat: 'png', // Can be 'png' or 'jpg', defaults to 'png'
      tokenType: 'spark', // 'sogni' or 'spark'
      network: 'fast' // 'fast' or 'relaxed'
    });

    // Receive project completion percentage in real-time
    project.on('progress', (progress) => {
      console.log('Project progress:', progress);
    });

    // Listen for individual project events: queued, completed, failed, error
    sogni.projects.on('project', (event) => {
      console.log(`Project event: "${event.type}" payload:`, event);
      if (['completed', 'failed', 'error'].includes(event.type)) {
        console.log('Project completed or failed, exiting...');
        // await client.account.logout();
        process.exit(0);
      }
    });

    // Listen for individual job events: initiating, started, progress, preview, completed, failed, error
    sogni.projects.on('job', (event) => {
      console.log(`Job event: "${event.type}" payload:`, event);
    });
  })
  .catch((error) => {
    console.error('Error initializing Sogni API client', error);
    setTimeout(() => {
      process.exit(1);
    }, 100);
  });
