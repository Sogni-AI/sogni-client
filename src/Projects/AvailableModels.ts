import Entity from '../lib/Entity';

export interface ModelData {
  id: string;
  name: string;
}

export type AvailableModelsData = {
  list: ModelData[];
  index: {
    [modelId: string]: ModelData;
  };
};

class AvailableModels extends Entity<AvailableModelsData> {
  constructor(data: AvailableModelsData) {
    super(data);
  }

  model(id: string): ModelData | undefined {
    return this.data.index[id];
  }

  get models(): ModelData[] {
    return this.data.list;
  }
}

export default AvailableModels;
