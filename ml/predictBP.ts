import { pcaModel, sbpModel, dbpModel } from "./loadModels";

export function predictBP(featureVec: Float32Array | number[]) {
  if (!pcaModel || !sbpModel || !dbpModel) {
    throw new Error("Models not loaded");
  }

  const x =
    featureVec instanceof Float32Array
      ? featureVec
      : new Float32Array(featureVec);

  const pcaOut = pcaModel.runSync([x])[0] as Float32Array;
  const sbpOut = sbpModel.runSync([pcaOut])[0] as Float32Array;
  const dbpOut = dbpModel.runSync([pcaOut])[0] as Float32Array;

  return {
    sbp: sbpOut[0],
    dbp: dbpOut[0],
    pcaDims: pcaOut.length,
  };
}
