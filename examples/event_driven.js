const { SogniClient } = require('@sogni-ai/sogni-client');

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
    // Create a project using the most popular model
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

    // Fired when one of project jobs completed, you can get the resultUrl from the job
    // without waiting for the project to complete
    project.on('jobCompleted', (job) => {
      console.log('Job completed:', job.id, job.resultUrl);
    });

    // Fired when one of project jobs failed
    project.on('jobFailed', (job) => {
      console.log('Job failed:', job.id, job.error);
    });

    // Receive project completion percentage in real-time
    project.on('progress', (progress) => {
      // console.log('Project progress:', progress);
    });

    // Fired when the project is fully completed
    project.on('completed', async (images) => {
      console.log('Project completed');
      await client.account.logout();
    });

    // Fired when the project failed
    project.on('failed', async (errorData) => {
      console.log('Project failed:', errorData);
      await client.account.logout();
    });
  })
  .catch((error) => {
    console.error('Error initializing Sogni API client', error);
    setTimeout(() => {
      process.exit(1);
    }, 100);
  });
