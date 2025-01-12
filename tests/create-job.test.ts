import { mockClient } from 'aws-sdk-client-mock';
import { CreateJobCommand, MediaConvertClient } from '@aws-sdk/client-mediaconvert';
import { S3Client, HeadObjectCommand } from '@aws-sdk/client-s3';
import { ECSClient, RunTaskCommand } from '@aws-sdk/client-ecs';
import createJob from '../src/create-job';
import { job, pipeline, encodingSettings, localJob } from './resources/create-job.test.data'

const mcMock = mockClient(MediaConvertClient);
const ecsMock = mockClient(ECSClient);
const s3Mock = mockClient(S3Client);

beforeEach(() => {
  mcMock.reset();
  ecsMock.reset();
  s3Mock.reset();

  process.env.LOAD_CREDENTIALS_FROM_ENV = 'true';
});

afterEach(() => {
  jest.clearAllMocks();
  delete process.env.LOAD_CREDENTIALS_FROM_ENV;
});

describe('create-job', () => {
  it('should create a job successfully', async () => {
    s3Mock.on(HeadObjectCommand).resolves({});
    mcMock.on(CreateJobCommand).resolves({});
    ecsMock.on(RunTaskCommand).resolves({});

    await createJob(job, pipeline, encodingSettings);

    expect(ecsMock.send).toHaveBeenCalled;
    expect(mcMock.send).toHaveBeenCalled;
  });
});


// Make sure LD_LIBRARY_PATH env variable is available -> export LD_LIBRARY_PATH=$LD_LIBRARY_PATH:/usr/local/lib/x86_64-linux-gnu
describe.skip('create-job', () => {
  jest.setTimeout(60000);
  it('runs a local test. Skipped since it takes a long time.', async () => {
    await createJob(localJob);
  });
});
