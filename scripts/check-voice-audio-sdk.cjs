'use strict';

const assert = require('node:assert/strict');
const sdk = require('../dist/index.js');
const { audioOutputContentType, resultMediaEvidence } = require('../dist/Projects/utils/index.js');
const { getFileContentType } = require('../dist/Projects/utils/fileContentType.js');
const { projectParamsFromRecoveredProject } = require('../dist/Projects/recovery.js');
const createJobRequestMessage = require('../dist/Projects/createJobRequestMessage.js').default;
const { mapAudioTier } = require('../dist/Projects/types/ModelOptions.js');
const { mediaInputToInlineDataUri, parseInlineMediaDataUri } = require('../dist/lib/mediaValidation.js');
const { MUSIC_MODEL_IDS, PREFERRED_MODEL_IDS } = require('../dist/Chat/modelRouting.js');

async function main() {
  // 1. Audio model helpers & routing separation (music vs speech vs STT)
  assert.equal(sdk.FISH_DRAMA_3_TTS_MODEL_ID, 'fish_drama_3_nvfp4');
  assert.equal(sdk.PARAKEET_STT_MODEL_ID, 'parakeet_tdt_0.6b_v3_bf16');
  assert.equal(sdk.NEMOTRON_STT_MODEL_ID, 'nemotron_3.5_transcribe_30b_a4b_nvfp4');

  assert.equal(sdk.isAudioModel('fish_drama_3_nvfp4'), true);
  assert.equal(sdk.isAudioModel('parakeet_tdt_0.6b_v3_bf16'), true);
  assert.equal(sdk.isAudioModel('nemotron_3.5_transcribe_30b_a4b_nvfp4'), true);
  assert.equal(sdk.isSpeechTtsModelId('qwen3_tts_1.7b_custom_voice_bf16'), true);
  assert.equal(sdk.isSpeechTtsModelId('fish_drama_3_nvfp4'), true);
  assert.equal(sdk.isSpeechTtsModelId('parakeet_tdt_0.6b_v3_bf16'), false);
  assert.equal(sdk.isSttModelId('parakeet_tdt_0.6b_v3_bf16'), true);
  assert.equal(sdk.isSttModelId('nemotron_3.5_transcribe_30b_a4b_nvfp4'), true);
  assert.equal(sdk.isSttModelId('fish_drama_3_nvfp4'), false);

  assert.equal(PREFERRED_MODEL_IDS.audio.fishDrama3, 'fish_drama_3_nvfp4');
  assert.equal(PREFERRED_MODEL_IDS.audio.parakeetStt, 'parakeet_tdt_0.6b_v3_bf16');
  assert.equal(PREFERRED_MODEL_IDS.audio.nemotronStt, 'nemotron_3.5_transcribe_30b_a4b_nvfp4');
  assert.ok(!MUSIC_MODEL_IDS.includes('fish_drama_3_nvfp4'));
  assert.ok(!MUSIC_MODEL_IDS.includes('parakeet_tdt_0.6b_v3_bf16'));
  assert.ok(!MUSIC_MODEL_IDS.includes('nemotron_3.5_transcribe_30b_a4b_nvfp4'));

  // 2. Result media evidence for STT JSON transcript artifacts
  assert.deepEqual(resultMediaEvidence({ outputFormat: 'json' }), {
    kind: 'audio',
    contentType: 'application/json'
  });
  assert.deepEqual(
    resultMediaEvidence({
      artifacts: [{ contentType: 'application/json; charset=utf-8', success: true }]
    }),
    {
      kind: 'audio',
      contentType: 'application/json; charset=utf-8'
    }
  );
  // Media artifacts (image/video/model/audio) must take precedence over secondary JSON metadata
  assert.deepEqual(
    resultMediaEvidence({
      artifacts: [
        { contentType: 'application/json', success: true },
        { contentType: 'image/png', success: true }
      ]
    }),
    {
      kind: 'image',
      contentType: 'image/png'
    }
  );
  assert.deepEqual(
    resultMediaEvidence({
      artifacts: [
        { contentType: 'application/json', success: true },
        { contentType: 'video/mp4', success: true }
      ]
    }),
    {
      kind: 'video',
      contentType: 'video/mp4'
    }
  );
  assert.deepEqual(
    resultMediaEvidence({
      artifacts: [
        { contentType: 'application/json', success: true },
        { contentType: 'audio/mpeg', success: true }
      ]
    }),
    {
      kind: 'audio',
      contentType: 'audio/mpeg'
    }
  );

  // 3. Sparse audio tier mapping & STT job request serialization
  const sttOptions = mapAudioTier({
    type: 'audio',
    stt: true,
    benchmark: { sec: 1, secCN: 0, secMaxPreviews: 0 },
    duration: { min: 1, max: 3600, default: 60 },
    timestamps: { allowed: ['none', 'sentence', 'word'], default: 'sentence' },
    diarize: { default: false },
    hotwords: { maxLength: 1000 },
    requiresReferenceAudio: true
  });
  assert.equal(sttOptions.stt, true);
  assert.deepEqual(sttOptions.steps, { min: 1, max: 1, step: 1, default: 1 });
  assert.equal(sttOptions.requiresReferenceAudio, true);
  assert.deepEqual(sttOptions.timestamps, { allowed: ['none', 'sentence', 'word'], default: 'sentence' });
  assert.deepEqual(sttOptions.diarize, { default: false });
  assert.deepEqual(sttOptions.hotwords, { maxLength: 1000 });

  const sttRequest = createJobRequestMessage(
    'job-stt-1',
    {
      type: 'audio',
      modelId: 'nemotron_3.5_transcribe_30b_a4b_nvfp4',
      numberOfMedia: 1,
      referenceAudio: true,
      timestamps: 'word',
      diarize: true,
      hotwords: 'Sogni, Supernet, Spark'
    },
    sttOptions
  );
  assert.equal(sttRequest.outputFormat, 'json');
  assert.equal(sttRequest.keyFrames[0].positivePrompt, '');
  assert.equal(sttRequest.keyFrames[0].hasReferenceAudio, true);
  assert.equal(sttRequest.keyFrames[0].timestamps, 'word');
  assert.equal(sttRequest.keyFrames[0].diarize, true);
  assert.equal(sttRequest.keyFrames[0].hotwords, 'Sogni, Supernet, Spark');

  // 4. Inline audio data URI validation for flac, ogg, opus, webm, m4a, mp3, wav
  const flacBytes = Buffer.from([0x66, 0x4c, 0x61, 0x43, 0x00, 0x00, 0x00, 0x22]);
  const oggBytes = Buffer.from([0x4f, 0x67, 0x67, 0x53, 0x00, 0x02, 0x00, 0x00]);
  const webmBytes = Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x86, 0x81]);
  const m4aBytes = Buffer.from([
    0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x4d, 0x34, 0x41, 0x20
  ]);
  const mp3Bytes = Buffer.from([0x49, 0x44, 0x33, 0x04, 0x00, 0x00, 0x00, 0x00]);

  assert.equal(
    parseInlineMediaDataUri(`data:audio/flac;base64,${flacBytes.toString('base64')}`, 'audio').mimeType,
    'audio/flac'
  );
  assert.equal(
    parseInlineMediaDataUri(`data:audio/ogg;base64,${oggBytes.toString('base64')}`, 'audio').mimeType,
    'audio/ogg'
  );
  assert.equal(
    parseInlineMediaDataUri(`data:audio/opus;base64,${oggBytes.toString('base64')}`, 'audio').mimeType,
    'audio/opus'
  );
  assert.equal(
    parseInlineMediaDataUri(`data:audio/webm;base64,${webmBytes.toString('base64')}`, 'audio').mimeType,
    'audio/webm'
  );
  assert.equal(
    parseInlineMediaDataUri(`data:audio/m4a;base64,${m4aBytes.toString('base64')}`, 'audio').mimeType,
    'audio/m4a'
  );
  assert.equal(
    parseInlineMediaDataUri(`data:audio/x-m4a;base64,${m4aBytes.toString('base64')}`, 'audio').mimeType,
    'audio/x-m4a'
  );
  assert.equal(
    parseInlineMediaDataUri(`data:audio/mp3;base64,${mp3Bytes.toString('base64')}`, 'audio').mimeType,
    'audio/mp3'
  );

  // 4b. Parameterized Blob/File MIME normalization, raw AAC ADTS vs MP3, and video/webm parity
  const aacMpeg4Bytes = Buffer.from([0xff, 0xf1, 0x50, 0x80, 0x02, 0x1f, 0xfc, 0x21]);
  const aacMpeg2Bytes = Buffer.from([0xff, 0xf9, 0x50, 0x80, 0x02, 0x1f, 0xfc, 0x21]);
  const mp3SyncBytes = Buffer.from([0xff, 0xfb, 0x90, 0x64, 0x00, 0x00, 0x00, 0x00]);
  assert.equal(getFileContentType(aacMpeg4Bytes, 'audio'), 'audio/aac');
  assert.equal(getFileContentType(aacMpeg2Bytes, 'audio'), 'audio/aac');
  assert.equal(getFileContentType(mp3SyncBytes, 'audio'), 'audio/mpeg');
  assert.equal(
    getFileContentType(new Blob([webmBytes], { type: 'audio/webm;codecs=opus' }), 'audio'),
    'audio/webm'
  );
  assert.equal(
    getFileContentType(new Blob([oggBytes], { type: 'AUDIO/OGG; codecs=opus' }), 'audio'),
    'audio/ogg'
  );
  if (typeof File !== 'undefined') {
    assert.equal(
      getFileContentType(
        new File([webmBytes], 'rec.webm', { type: 'video/webm;codecs=vp9,opus' }),
        'video'
      ),
      'video/webm'
    );
  }
  assert.equal(
    parseInlineMediaDataUri(`data:audio/aac;base64,${aacMpeg4Bytes.toString('base64')}`, 'audio').mimeType,
    'audio/aac'
  );
  assert.equal(
    parseInlineMediaDataUri(`data:audio/aac;base64,${aacMpeg2Bytes.toString('base64')}`, 'audio').mimeType,
    'audio/aac'
  );
  assert.equal(
    parseInlineMediaDataUri(`data:video/webm;base64,${webmBytes.toString('base64')}`, 'video').mimeType,
    'video/webm'
  );

  // 4c. Shared audio outputFormat helper & recovery outputFormat fallback
  assert.equal(audioOutputContentType('mp3'), 'audio/mpeg');
  assert.equal(audioOutputContentType('WAV'), 'audio/wav');
  assert.equal(audioOutputContentType(' flac '), 'audio/flac');
  assert.equal(audioOutputContentType('json'), 'application/json');
  assert.equal(audioOutputContentType('unknown'), undefined);

  const encodeRecoveryReq = (obj) => Buffer.from(JSON.stringify(obj), 'utf8').toString('base64');
  assert.equal(
    projectParamsFromRecoveredProject({
      id: 'rec-kf',
      modelType: 'audio',
      model: { id: 'fish_drama_3_nvfp4', type: 'audio' },
      clientRequestData: encodeRecoveryReq({ keyFrames: [{ modelID: 'fish_drama_3_nvfp4', outputFormat: 'wav' }] })
    }).outputFormat,
    'wav'
  );
  assert.equal(
    projectParamsFromRecoveredProject({
      id: 'rec-proj',
      modelType: 'audio',
      outputFormat: 'flac',
      model: { id: 'fish_drama_3_nvfp4', type: 'audio' },
      clientRequestData: encodeRecoveryReq({ keyFrames: [{ modelID: 'fish_drama_3_nvfp4' }] })
    }).outputFormat,
    'flac'
  );

  // 5. estimateAudioCost characters query parameter + STT getResult contentType
  const client = await sdk.SogniClient.createInstance({
    disableSocket: true,
    apiKey: 'test-api-key',
    restEndpoint: 'https://api.example.test'
  });

  let capturedEstimatePath = null;
  client.apiClient.socket.get = async (path) => {
    capturedEstimatePath = path;
    return {
      quote: {
        project: {
          costInToken: '0.25',
          costInUSD: '0.01',
          costInSpark: '0.25',
          costInSogni: '1.0'
        }
      }
    };
  };
  const estimate = await client.projects.estimateAudioCost({
    tokenType: 'spark',
    model: 'fish_drama_3_nvfp4',
    duration: 0,
    steps: 1,
    numberOfMedia: 1,
    characters: 512
  });
  assert.equal(estimate.spark, '0.25');
  assert.ok(capturedEstimatePath.includes('characters=512'), capturedEstimatePath);

  await client.projects.estimateAudioCost({
    tokenType: undefined,
    model: 'qwen3_tts_1.7b_custom_voice_bf16',
    duration: undefined,
    steps: 0,
    numberOfMedia: 0,
    characters: 0
  });
  assert.ok(
    capturedEstimatePath.startsWith('/api/v1/job-audio/estimate/spark/qwen3_tts_1.7b_custom_voice_bf16/0/1/1?'),
    capturedEstimatePath
  );
  assert.ok(capturedEstimatePath.includes('characters=1'), capturedEstimatePath);
  assert.ok(!capturedEstimatePath.includes('undefined'), capturedEstimatePath);

  // Retired happyhorse-1.1-* selectors must not be re-injected into hosted SogniTools
  const genVideoEnum = sdk.SogniTools.generateVideo.function.parameters.properties.videoModel.enum;
  const animPhotoEnum = sdk.SogniTools.animatePhoto.function.parameters.properties.videoModel.enum;
  for (const retired of ['happyhorse-1.1-t2v', 'happyhorse-1.1-i2v', 'happyhorse-1.1-r2v']) {
    assert.ok(!genVideoEnum.includes(retired), `generateVideo must not expose ${retired}`);
    assert.ok(!animPhotoEnum.includes(retired), `animatePhoto must not expose ${retired}`);
  }

  let capturedDownloadParams = null;
  client.projects.getStatus = async () => ({
    id: 'proj-stt-1',
    status: 'completed',
    finished: true,
    model: { id: 'parakeet_tdt_0.6b_v3_bf16' },
    workerJobs: [],
    completedWorkerJobs: [{ id: 'job-1', imgID: 'job-1', status: 'jobCompleted', outputFormat: 'json' }]
  });
  client.projects.mediaDownloadUrl = async (params) => {
    capturedDownloadParams = params;
    return 'https://cdn.sogni.ai/transcripts/job-1.json';
  };
  const sttResult = await client.projects.getResult('proj-stt-1');
  assert.equal(sttResult.jobs[0].kind, 'audio');
  assert.equal(sttResult.jobs[0].url, 'https://cdn.sogni.ai/transcripts/job-1.json');
  assert.equal(capturedDownloadParams.contentType, 'application/json');

  // getResult resolves audioContentType from snapshot.outputFormat / job.outputFormat -> result.contentType -> default
  client.projects.getStatus = async () => ({
    id: 'proj-tts-wav',
    status: 'completed',
    finished: true,
    outputFormat: 'wav',
    model: { id: 'fish_drama_3_nvfp4', type: 'audio' },
    workerJobs: [],
    completedWorkerJobs: [{ id: 'job-wav', imgID: 'job-wav', status: 'jobCompleted' }]
  });
  await client.projects.getResult('proj-tts-wav');
  assert.equal(capturedDownloadParams.contentType, 'audio/wav');

  client.projects.getStatus = async () => ({
    id: 'proj-tts-default-mp3',
    status: 'completed',
    finished: true,
    model: { id: 'minimax_music3', type: 'audio' },
    workerJobs: [],
    completedWorkerJobs: [{ id: 'job-mp3', imgID: 'job-mp3', status: 'jobCompleted' }]
  });
  await client.projects.getResult('proj-tts-default-mp3');
  assert.equal(capturedDownloadParams.contentType, 'audio/mpeg');

  // handleJobResult prefers explicit outputFormat, then result.contentType (e.g. audio/wav), before defaulting to audio/mpeg,
  // and Job._audioContentType checks job.data.outputFormat ?? project.params.outputFormat.
  // Also projects.create defaults outputFormat='json' & positivePrompt='' when modelOptions.stt === true on a custom STT id.
  client.projects.getModelOptions = async (modelId) => {
    if (modelId === 'custom_stt_v1') {
      return mapAudioTier({
        type: 'audio',
        stt: true,
        benchmark: { sec: 1, secCN: 0, secMaxPreviews: 0 },
        duration: { min: 1, max: 600, default: 30 }
      });
    }
    return mapAudioTier({
      type: 'audio',
      benchmark: { sec: 1, secCN: 0, secMaxPreviews: 0 }
    });
  };
  let sentJobRequest = null;
  client.apiClient.socket.send = async (_event, payload) => {
    sentJobRequest = payload;
  };
  const customSttProject = await client.projects.create({
    type: 'audio',
    modelId: 'custom_stt_v1',
    numberOfMedia: 1
  });
  assert.equal(sentJobRequest.outputFormat, 'json');
  assert.equal(sentJobRequest.keyFrames[0].positivePrompt, '');
  assert.equal(customSttProject.params.outputFormat, 'json');

  const ttsProjectNoFormat = await client.projects.create({
    type: 'audio',
    modelId: 'fish_drama_3_nvfp4',
    positivePrompt: 'Testing WAV artifact fallback',
    numberOfMedia: 1
  });
  client.projects.handleJobState({
    type: 'jobStarted',
    jobID: ttsProjectNoFormat.id,
    imgID: 'img-wav-1',
    workerName: 'worker-1',
    jobIndex: 0
  });
  // Add a pending job so job._audioContentType is also exercised on getResultUrl()
  ttsProjectNoFormat._addJob({
    id: 'img-wav-1',
    projectId: ttsProjectNoFormat.id,
    status: 'processing',
    step: 0,
    stepCount: 1
  });
  await client.projects.handleJobResult({
    jobID: ttsProjectNoFormat.id,
    imgID: 'img-wav-1',
    performedStepCount: 1,
    outputFormat: 'flac',
    artifacts: [{ contentType: 'audio/wav', success: true }]
  });
  assert.equal(capturedDownloadParams.contentType, 'audio/flac');

  const jobInstance = ttsProjectNoFormat.job('img-wav-1');
  jobInstance._update({ resultUrl: null });
  await jobInstance.getResultUrl();
  assert.equal(capturedDownloadParams.contentType, 'audio/flac');

  // When neither project.params.outputFormat nor data.outputFormat is set, handleJobResult uses result.contentType
  await client.projects.handleJobResult({
    jobID: ttsProjectNoFormat.id,
    imgID: 'img-wav-2',
    performedStepCount: 1,
    artifacts: [{ contentType: 'audio/wav', success: true }]
  });
  assert.equal(capturedDownloadParams.contentType, 'audio/wav');

  // 6. OpenAI-compatible sogni.audio.speech.create & sogni.audio.transcriptions.create (with disableSocket: true)
  const originalFetch = globalThis.fetch;
  const fetchCalls = [];
  globalThis.fetch = async (url, init) => {
    fetchCalls.push({ url: String(url), init });
    if (String(url).endsWith('/v1/audio/speech')) {
      return new Response(Uint8Array.from([0x52, 0x49, 0x46, 0x46]), {
        status: 200,
        headers: { 'content-type': 'audio/wav' }
      });
    }
    if (String(url).endsWith('/v1/audio/transcriptions')) {
      const form = init.body;
      const format = form.get('response_format');
      if (format === 'srt') {
        return new Response('1\n00:00:00,000 --> 00:00:01,500\nHello Sogni\n', {
          status: 200,
          headers: { 'content-type': 'application/x-subrip' }
        });
      }
      return new Response(
        JSON.stringify({
          text: '[S01] Hello Sogni',
          model: 'nemotron_3.5_transcribe_30b_a4b_nvfp4',
          duration: 4.2,
          diarized: true,
          segments: [{ id: 0, start: 0, end: 4.2, text: 'Hello Sogni', speaker: 'S01' }]
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      );
    }
    throw new Error(`Unexpected fetch URL: ${url}`);
  };

  try {
    const speechRes = await client.audio.speech.create({
      model: 'drama3',
      input: '[sighs] Finally home. <whisper>Do not wake them.</whisper>',
      response_format: 'wav',
      creativity: 1.4 // Must be stripped on drama3!
    });
    const wavBytes = new Uint8Array(await speechRes.arrayBuffer());
    assert.equal(wavBytes.byteLength, 4);
    assert.equal(fetchCalls[0].url, 'https://api.example.test/v1/audio/speech');
    assert.equal(fetchCalls[0].init.headers['api-key'], 'test-api-key');
    const speechBody = JSON.parse(fetchCalls[0].init.body);
    assert.equal(speechBody.model, 'drama3');
    assert.equal(speechBody.response_format, 'wav');
    assert.equal(speechBody.creativity, undefined);

    const jsonTranscript = await client.audio.transcriptions.create({
      file: flacBytes,
      diarize: true,
      hotwords: 'Sogni, Spark',
      timestamp_granularities: ['segment', 'word']
    });
    assert.equal(jsonTranscript.text, '[S01] Hello Sogni');
    assert.equal(jsonTranscript.diarized, true);
    assert.equal(fetchCalls[1].url, 'https://api.example.test/v1/audio/transcriptions');
    const form = fetchCalls[1].init.body;
    assert.equal(form.get('model'), 'nemotron');
    assert.equal(form.get('diarize'), 'true');
    assert.equal(form.get('hotwords'), 'Sogni, Spark');
    assert.equal(form.get('response_format'), 'verbose_json');
    assert.deepEqual(form.getAll('timestamp_granularities[]'), ['segment', 'word']);

    // Raw AAC buffer uploads with .aac extension, and camelCase timestampGranularities defaults response_format to verbose_json
    await client.audio.transcriptions.create({
      file: aacMpeg4Bytes,
      timestampGranularities: ['word']
    });
    const aacForm = fetchCalls[fetchCalls.length - 1].init.body;
    assert.equal(aacForm.get('response_format'), 'verbose_json');
    assert.deepEqual(aacForm.getAll('timestamp_granularities[]'), ['word']);
    assert.equal(aacForm.get('file').name, 'audio.aac');
    assert.equal(aacForm.get('file').type, 'audio/aac');

    // Remote trusted media fetch sniffs raw AAC and WebM correctly
    const prevFetch = globalThis.fetch;
    globalThis.fetch = async (remoteUrl) => {
      if (String(remoteUrl).includes('clip.aac')) {
        return new Response(aacMpeg4Bytes, {
          status: 200,
          headers: { 'content-type': 'application/octet-stream' }
        });
      }
      return new Response(webmBytes, {
        status: 200,
        headers: { 'content-type': 'video/webm;codecs=vp9' }
      });
    };
    const inlineAac = await mediaInputToInlineDataUri('https://cdn.sogni.ai/audio/clip.aac', 'audio');
    assert.ok(inlineAac.startsWith('data:audio/aac;base64,'), inlineAac);
    const inlineWebm = await mediaInputToInlineDataUri('https://cdn.sogni.ai/video/clip.webm', 'video');
    assert.ok(inlineWebm.startsWith('data:video/webm;base64,'), inlineWebm);
    globalThis.fetch = prevFetch;

    const srtTranscript = await client.audio.transcriptions.create({
      file: mp3Bytes,
      model: 'parakeet',
      response_format: 'srt'
    });
    assert.match(srtTranscript, /00:00:00,000 --> 00:00:01,500/);

    // Omitted model defaults to 'clone' when referenceAudio is supplied, and 'voice' otherwise
    const clonedSpeechRes = await client.audio.speech.create({
      input: 'Read this in my cloned voice.',
      referenceAudio: 'https://cdn.sogni.ai/voices/sample.wav'
    });
    await clonedSpeechRes.arrayBuffer();
    const clonedBody = JSON.parse(fetchCalls[fetchCalls.length - 1].init.body);
    assert.equal(clonedBody.model, 'clone');
    assert.equal(clonedBody.reference_audio, 'https://cdn.sogni.ai/voices/sample.wav');

    const defaultVoiceRes = await client.audio.speech.create({
      input: 'Read this in the default studio voice.'
    });
    await defaultVoiceRes.arrayBuffer();
    const defaultVoiceBody = JSON.parse(fetchCalls[fetchCalls.length - 1].init.body);
    assert.equal(defaultVoiceBody.model, 'voice');

    // Case-insensitive Drama 3 aliases ('DRAMA3', 'fish-drama-3') also omit creativity
    for (const alias of ['DRAMA3', 'fish-drama-3', 'FISH_DRAMA_3_NVFP4']) {
      const res = await client.audio.speech.create({
        model: alias,
        input: '[warmly] Testing alias.',
        creativity: 1.2
      });
      await res.arrayBuffer();
      const body = JSON.parse(fetchCalls[fetchCalls.length - 1].init.body);
      assert.equal(body.creativity, undefined, `Expected creativity omitted for ${alias}`);
    }

    // hotwords alone and prompt alone each auto-select 'nemotron'
    await client.audio.transcriptions.create({
      file: flacBytes,
      hotwords: 'Sogni, Supernet'
    });
    assert.equal(fetchCalls[fetchCalls.length - 1].init.body.get('model'), 'nemotron');

    await client.audio.transcriptions.create({
      file: flacBytes,
      prompt: 'Technical keynote about decentralized GPUs'
    });
    assert.equal(fetchCalls[fetchCalls.length - 1].init.body.get('model'), 'nemotron');

    // Pre-aborted signal throws before authenticateRequest / fetch
    let authCalledOnPreAbort = false;
    const origAuthReq = client.apiClient.auth.authenticateRequest.bind(client.apiClient.auth);
    client.apiClient.auth.authenticateRequest = async (opts) => {
      authCalledOnPreAbort = true;
      return origAuthReq(opts);
    };
    const preAborted = new AbortController();
    preAborted.abort(new Error('pre-aborted-reason'));
    await assert.rejects(
      () =>
        client.audio.speech.create({
          model: 'drama3',
          input: 'Should not send',
          signal: preAborted.signal
        }),
      /pre-aborted-reason/
    );
    assert.equal(authCalledOnPreAbort, false);
    client.apiClient.auth.authenticateRequest = origAuthReq;

    // 200 text/html when JSON transcription format was requested must throw ApiError
    globalThis.fetch = async () =>
      new Response(`<!DOCTYPE html><html><body>${'x'.repeat(4096)}</body></html>`, {
        status: 200,
        headers: { 'content-type': 'text/html; charset=utf-8' }
      });
    await assert.rejects(
      () => client.audio.transcriptions.create({ file: flacBytes }),
      (err) => {
        assert.ok(err instanceof sdk.ApiError);
        assert.match(err.message, /unexpected HTML response/i);
        assert.ok(err.message.length < 200);
        return true;
      }
    );

    // 200 non-object JSON primitive/array on JSON transcription format must throw ApiError
    globalThis.fetch = async () =>
      new Response('"just-a-string"', {
        status: 200,
        headers: { 'content-type': 'application/json' }
      });
    await assert.rejects(
      () => client.audio.transcriptions.create({ file: flacBytes }),
      (err) => err instanceof sdk.ApiError && /invalid JSON object/i.test(err.message)
    );

    // Non-2xx primitive JSON, nested errorCode, and multi-KB HTML gateway error sanitization
    globalThis.fetch = async () =>
      new Response('"rate limit upstream"', {
        status: 429,
        headers: { 'content-type': 'application/json', 'retry-after': '5' }
      });
    await assert.rejects(
      () => client.audio.speech.create({ model: 'drama3', input: 'Test' }),
      (err) => {
        assert.ok(err instanceof sdk.ApiError);
        assert.equal(err.status, 429);
        assert.equal(err.message, 'rate limit upstream');
        assert.equal(err.payload['0'], undefined, 'must not spread string chars into payload');
        return true;
      }
    );

    globalThis.fetch = async () =>
      new Response(JSON.stringify({ error: { errorCode: 4021, message: 'Nested code failure' } }), {
        status: 400,
        headers: { 'content-type': 'application/json' }
      });
    await assert.rejects(
      () => client.audio.speech.create({ model: 'drama3', input: 'Test' }),
      (err) =>
        err instanceof sdk.ApiError &&
        err.payload.errorCode === 4021 &&
        err.message === 'Nested code failure'
    );

    globalThis.fetch = async () =>
      new Response(`<!DOCTYPE html><html><head><title>502</title></head><body>${'G'.repeat(8192)}</body></html>`, {
        status: 502,
        statusText: 'Bad Gateway',
        headers: { 'content-type': 'text/html' }
      });
    await assert.rejects(
      () => client.audio.transcriptions.create({ file: flacBytes }),
      (err) => {
        assert.ok(err instanceof sdk.ApiError);
        assert.equal(err.status, 502);
        assert.doesNotMatch(err.message, /<!DOCTYPE|<html|GGGG/i);
        assert.ok(err.message.length < 120);
        return true;
      }
    );

    // Mid-body AbortSignal abort on both createSpeech and createTranscription
    globalThis.fetch = async () => {
      let sentFirst = false;
      const body = new ReadableStream({
        pull(c) {
          if (!sentFirst) {
            sentFirst = true;
            c.enqueue(Uint8Array.from([0x52, 0x49]));
            return;
          }
          return new Promise(() => {});
        }
      });
      return new Response(body, { status: 200, headers: { 'content-type': 'audio/wav' } });
    };
    const speechMidAbort = new AbortController();
    const streamingSpeechRes = await client.audio.speech.create({
      model: 'drama3',
      input: 'Mid-body abort test',
      signal: speechMidAbort.signal
    });
    setTimeout(() => speechMidAbort.abort(new Error('mid-speech-stream-abort')), 15);
    await assert.rejects(() => streamingSpeechRes.arrayBuffer(), /mid-speech-stream-abort/);

    globalThis.fetch = async () => {
      const body = new ReadableStream({
        pull() {
          return new Promise(() => {});
        }
      });
      return new Response(body, { status: 200, headers: { 'content-type': 'application/json' } });
    };
    const sttMidAbort = new AbortController();
    const sttPromise = client.audio.transcriptions.create({
      file: flacBytes,
      signal: sttMidAbort.signal
    });
    setTimeout(() => sttMidAbort.abort(new Error('mid-stt-body-abort')), 15);
    await assert.rejects(() => sttPromise, /mid-stt-body-abort/);
  } finally {
    globalThis.fetch = originalFetch;
    client.dispose();
  }

  console.log('Voice TTS/STT and OpenAI audio SDK checks passed');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
