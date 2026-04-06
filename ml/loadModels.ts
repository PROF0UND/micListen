import { loadTensorflowModel } from "react-native-fast-tflite";

let _loaded = false;

export let pcaModel: any = null;
export let sbpModel: any = null;
export let dbpModel: any = null;

export async function loadBpModels() {
  if (_loaded) return;

  pcaModel = await loadTensorflowModel(
    require("../assets/models/pca.tflite")
  );

  sbpModel = await loadTensorflowModel(
    require("../assets/models/dnr_sbp.tflite")
  );

  dbpModel = await loadTensorflowModel(
    require("../assets/models/dnr_dbp.tflite")
  );

  _loaded = true;

  console.log("Models loaded");
  console.log("PCA:", pcaModel.inputs, pcaModel.outputs);
  console.log("SBP:", sbpModel.inputs, sbpModel.outputs);
  console.log("DBP:", dbpModel.inputs, dbpModel.outputs);
}
