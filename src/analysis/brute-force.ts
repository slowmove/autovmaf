import { BitrateResolutionPair } from '../models/bitrate-resolution-pair';
import { QualityAnalysisModel, qualityAnalysisModelToString } from '../models/quality-analysis-model';
import { Resolution } from '../models/resolution';
import { Pipeline } from '../pipelines/pipeline';
import path from 'path';
import logger from '../logger';
import { BitrateRange } from '../models/bitrateRange';
import * as fs from 'fs';

export type AnalysisOptions = {
  models?: QualityAnalysisModel[];
  bitrates?: number[];
  resolutions?: Resolution[];
  filterFunction?: (pair: BitrateResolutionPair) => boolean;
  concurrency?: boolean;
  pipelineVariables?: { [key: string]: string[] };
  skipTranscode?: boolean,
  skipExisting?: boolean
};

const defaultModels = [QualityAnalysisModel.HD];

const defaultBitrates = [
  150000,
  300000,
  400000,
  500000,
  600000,
  700000,
  800000,
  900000,
  1000000,
  1200000,
  1400000,
  1600000,
  1800000,
  2000000,
  2200000,
  2400000,
  2600000,
  2800000,
  3000000,
  3400000,
  3800000,
  4200000,
  4600000,
  5000000,
  5500000,
  6000000,
  6500000,
  7000000,
  7500000,
  8000000,
  8500000,
  9000000,
];

const defaultResolutions: Resolution[] = [
  { width: 640, height: 360},
  { width: 768, height: 432},
  { width: 960, height: 540},
  { width: 1280, height: 720},
  { width: 1920, height: 1080},
];

const defaultFilterFunction: (pair: BitrateResolutionPair) => boolean = ({ bitrate, resolution }) =>
  bitrate >= resolution.width * resolution.height * 0.3 && bitrate <= resolution.width * resolution.height * 8;

const defaultConcurrency = true;

/**
 * Runs quality analysis on a file and returns the optimal ABR-ladder.
 *
 * @param directory Directory in which to put files.
 * @param reference Reference video file.
 * @param pipeline The pipeline to use in analysis.
 * @param options Options to use in analysis.
 */
export default async function analyzeBruteForce(directory: string, reference: string, pipeline: Pipeline, options: AnalysisOptions = {}) {
  const models = options.models !== undefined ? options.models : defaultModels;
  const bitrates = options.bitrates !== undefined ? options.bitrates : defaultBitrates;
  const resolutions = options.resolutions !== undefined ? options.resolutions : defaultResolutions;
  const filterFunction = options.filterFunction !== undefined ? options.filterFunction : defaultFilterFunction;
  const concurrency = options.concurrency !== undefined ? options.concurrency : defaultConcurrency;

  let pairs = preparePairs(resolutions, bitrates, filterFunction)

  if (options.pipelineVariables) {
    // Create all combinations of bitrate, resolution, and variables
    Object.entries(options.pipelineVariables).forEach(([variableName, values]) => {
      //console.log(`variableName: ${variableName}`);
      pairs = pairs.flatMap(pair =>
        values.map( value => {
          const variables = pair.ffmpegOptionVariables ? {...pair.ffmpegOptionVariables} : {};
          variables[variableName] = value;
          return {...pair, ffmpegOptionVariables: variables}
        }) as BitrateResolutionPair[]
      )  
    })
  }

  const analyzePair = async (pair: BitrateResolutionPair) => {
    let outFile = `${directory}/${pair.resolution.width}x${pair.resolution.height}_${pair.bitrate}`;
    if (pair.ffmpegOptionVariables) {
      Object.entries(pair.ffmpegOptionVariables).forEach(([variable, value]) => {
        outFile = outFile + `_${variable}_${value}`;
      });
    }
    outFile = outFile + ".mp4";
    const skip = options.skipTranscode || (options.skipExisting && fs.existsSync(outFile));
    if (options.skipTranscode) {
      console.log(`Skipping transcode for ${outFile}`);
    } else if (options.skipExisting && fs.existsSync(outFile)) {
      console.log(`Skipping transcode for ${outFile} because file exists`);
    }
    const variant = skip ? outFile : await pipeline.transcode(
      reference,
      pair.resolution,
      pair.bitrate,
      outFile,
      pair.ffmpegOptionVariables
    );

    if (variant === '') {
      logger.error(`Error transcoding ${reference}`);
      return [];
    }

    const qualityFile = variant.replace('.mp4', '_vmaf.json');

    if (concurrency) {
      return await Promise.all(
        models.map(async model => ({
          model,
          qualityFile: await pipeline.analyzeQuality(
            reference,
            variant,
            path.dirname(qualityFile) + `/${qualityAnalysisModelToString(model)}/` + path.basename(qualityFile),
            model
          ),
        }))
      );
    } else {
      let results: any = [];
      for (const model of models) {
        results.push({
          model,
          qualityFile: await pipeline.analyzeQuality(
            reference,
            variant,
            path.dirname(qualityFile) + `/${qualityAnalysisModelToString(model)}/` + path.basename(qualityFile),
            model
          ),
        });
      }
      return results;
    }
  };

  if (analyzePair.length === 0) {
    logger.error(`No pairs to analyze`);
    return [];
  }

  let qualityFiles = new Map<QualityAnalysisModel, string[]>();
  if (concurrency === true) {
    (await Promise.all(pairs.map(pair => analyzePair(pair)))).flat().forEach(file => {
      qualityFiles.set(file.model, [...(qualityFiles.get(file.model) ?? []), file.qualityFile]);
    });
  } else {
    for (const pair of pairs) {
      (await analyzePair(pair)).forEach(file => {
        qualityFiles.set(file.model, [...(qualityFiles.get(file.model) ?? []), file.qualityFile]);
      });
    }
  }
}

/**
 * Prepares the resolution-bitrate pairs to be analyzed.
 *
 * @param resolutions The different resolutions to be analyzed. Also contains the bitrate range.
 * @param bitrates A list of bitrates that can analyzed.
 * @param filterFunction A filter function to be used for filtering out bitrates.
 */
export function preparePairs(resolutions: Resolution[], bitrates: number[], filterFunction: (pair: BitrateResolutionPair) => boolean): BitrateResolutionPair[] {
  return resolutions
    .flat()
    .flatMap(resolution =>
      bitrates.map(bitrate =>
        (filterFunction({ bitrate, resolution }) && (resolution.range === undefined || checkIfBitrateInRange(bitrate, resolution.range))) 
          ? {
              resolution,
              bitrate,
            }
          : undefined
      )
    )
    .filter(pair => pair !== undefined) as BitrateResolutionPair[];
}

function checkIfBitrateInRange(bitrate: number, range: BitrateRange): boolean {
  let minBitrate = range.min ? range.min : defaultBitrates[0];
  let maxBitrate = range.max ? range.max : defaultBitrates[defaultBitrates.length - 1];
  return bitrate >= minBitrate && bitrate <= maxBitrate ? true : false;
}
