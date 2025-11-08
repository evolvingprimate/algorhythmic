declare module 'delaunator' {
  export default class Delaunator<P = number[]> {
    static from<P = any>(
      points: ArrayLike<P>,
      getX?: (point: P) => number,
      getY?: (point: P) => number
    ): Delaunator<P>;

    constructor(coords: ArrayLike<number>);

    coords: ArrayLike<number>;
    triangles: Uint32Array;
    halfedges: Int32Array;
    hull: Uint32Array;
    inedges: Int32Array;
    outedges: Int32Array;

    update(): void;
  }
}
