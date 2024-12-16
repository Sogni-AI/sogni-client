import { cloneDeep } from 'lodash';
import TypedEventEmitter from './TypedEventEmitter';

/**
 * @inline
 */
export interface EntityEvents {
  updated: string[];
}

abstract class DataEntity<D, E extends EntityEvents = EntityEvents> extends TypedEventEmitter<E> {
  protected data: D;

  protected lastUpdated: Date = new Date();

  constructor(data: D) {
    super();
    this.data = data;
  }

  /**
   * @internal
   * @param delta
   */
  _update(delta: Partial<D>) {
    //@ts-ignore
    const changedKeys = Object.keys(delta).filter((key) => this.data[key] !== delta[key]);
    this.data = { ...this.data, ...delta };
    this.lastUpdated = new Date();
    this.emit('updated', changedKeys);
  }

  /**
   * Get a copy of the entity's data
   */
  toJSON(): D {
    return cloneDeep(this.data);
  }
}

export default DataEntity;
