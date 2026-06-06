declare module "elkjs/lib/elk.bundled.js" {
  type ElkLayoutOptions = Record<string, string>;

  type ElkNode = {
    id: string;
    x?: number;
    y?: number;
    width?: number;
    height?: number;
    children?: ElkNode[];
    edges?: ElkEdge[];
    layoutOptions?: ElkLayoutOptions;
  };

  type ElkEdge = {
    id: string;
    sources: string[];
    targets: string[];
    sections?: Array<{
      startPoint: { x: number; y: number };
      endPoint: { x: number; y: number };
      bendPoints?: Array<{ x: number; y: number }>;
    }>;
  };

  export default class ELK {
    layout<T extends ElkNode>(graph: T): Promise<T>;
  }
}
