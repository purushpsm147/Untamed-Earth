/** Live WebGL object counts, measured by wrapping the context's create/delete calls (installed before any context exists). */
export interface GlCounts { buffer: number; texture: number; program: number; vao: number; framebuffer: number; renderbuffer: number }

export function installGlCounter(): () => GlCounts {
  const live: GlCounts = { buffer: 0, texture: 0, program: 0, vao: 0, framebuffer: 0, renderbuffer: 0 };
  if (typeof WebGL2RenderingContext === 'undefined') return () => ({ ...live });
  const P = WebGL2RenderingContext.prototype as unknown as Record<string, (...a: unknown[]) => unknown>;
  const wrap = (create: string, del: string, key: keyof GlCounts): void => {
    const c = P[create]!;
    const d = P[del]!;
    P[create] = function (this: unknown, ...a: unknown[]) {
      const r = c.apply(this, a);
      if (r) live[key]++;
      return r;
    };
    P[del] = function (this: unknown, o: unknown) {
      if (o) live[key]--;
      return d.call(this, o);
    };
  };
  wrap('createBuffer', 'deleteBuffer', 'buffer');
  wrap('createTexture', 'deleteTexture', 'texture');
  wrap('createProgram', 'deleteProgram', 'program');
  wrap('createVertexArray', 'deleteVertexArray', 'vao');
  wrap('createFramebuffer', 'deleteFramebuffer', 'framebuffer');
  wrap('createRenderbuffer', 'deleteRenderbuffer', 'renderbuffer');
  return () => ({ ...live });
}
