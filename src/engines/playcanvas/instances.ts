import * as pc from 'playcanvas';
import type { InstancesScene } from '../../harness/types';
import { toMaterial, toMesh } from './field';
import type { Built, PcCtx } from './index';

export function buildInstances({ app, device }: PcCtx, d: InstancesScene): Built {
  const format = pc.VertexFormat.getDefaultInstancingFormat(device);
  // d.matrices already has the Mat4.data layout: the buffer uploads it as-is.
  const vb = new pc.VertexBuffer(device, format, d.count, { usage: pc.BUFFER_DYNAMIC, data: d.matrices });
  const mi = new pc.MeshInstance(toMesh(device, d.geometry), toMaterial(d.material));
  mi.setInstancing(vb); // culling off
  const e = new pc.Entity('instances');
  e.addComponent('render', { meshInstances: [mi] });
  app.root.addChild(e);
  return {
    path: 'MeshInstance.setInstancing with a dynamic vertex buffer',
    update: () => vb.setData(d.matrices),
  };
}
