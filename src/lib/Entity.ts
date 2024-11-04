import { cloneDeep } from 'lodash';
import TypedEventEmitter from './TypedEventEmitter';

type EntityEvents<D> = {
  updated: Partial<D>;
};

abstract class Entity<D> extends TypedEventEmitter<EntityEvents<D>> {
  protected data: D;

  constructor(data: D) {
    super();
    this.data = data;
  }

  _update(delta: Partial<D>) {
    this.data = { ...this.data, ...delta };
    this.emit('updated', delta);
  }

  toJSON(): D {
    return cloneDeep(this.data);
  }
}

export default Entity;
