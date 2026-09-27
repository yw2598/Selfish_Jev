import {parentPort,workerData} from 'node:worker_threads';
import {buildReplay} from './replay-builder.mjs';
try{const result=await buildReplay(workerData.file,{episode:workerData.episode,output:workerData.output,onProgress:p=>parentPort.postMessage({state:'building',...p})});parentPort.postMessage({state:'ready',turn:result.verifiedTurns,source:result.source,createdAt:result.createdAt,warnings:result.warnings});}catch(e){parentPort.postMessage({state:'error',error:e.message});process.exitCode=1;}
