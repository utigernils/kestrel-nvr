import{i as e,n as t,t as n}from"./jsx-runtime-DyZJNswf.js";var r=e(t(),1),i=n(),a=5,o=3,s=2.4,c=`#version 300 es
in vec2 aPosition;
void main() {
  gl_Position = vec4(aPosition, 0.0, 1.0);
}`,l=`#version 300 es
precision highp float;
precision highp int;
uniform vec2 uResolution;
uniform float uTime;
uniform vec3 uStops[${a}];
uniform int uStopCount;
uniform float uAmplitude;
uniform float uBlend;
uniform float uHeight;
uniform float uScale;
uniform float uGlow;
uniform float uBrightness;
uniform int uLayers;
uniform float uFlip;
uniform vec3 uPointer;
uniform float uReveal;
uniform float uOpacity;
uniform float uLightMode;
out vec4 outColor;

vec3 permute(vec3 x) {
  return mod(((x * 34.0) + 1.0) * x, 289.0);
}

float snoise(vec2 v) {
  const vec4 C = vec4(0.211324865405187, 0.366025403784439, -0.577350269189626, 0.024390243902439);
  vec2 i = floor(v + dot(v, C.yy));
  vec2 x0 = v - i + dot(i, C.xx);
  vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
  vec4 x12 = x0.xyxy + C.xxzz;
  x12.xy -= i1;
  i = mod(i, 289.0);
  vec3 p = permute(permute(i.y + vec3(0.0, i1.y, 1.0)) + i.x + vec3(0.0, i1.x, 1.0));
  vec3 m = max(0.5 - vec3(dot(x0, x0), dot(x12.xy, x12.xy), dot(x12.zw, x12.zw)), 0.0);
  m = m * m;
  m = m * m;
  vec3 x = 2.0 * fract(p * C.www) - 1.0;
  vec3 h = abs(x) - 0.5;
  vec3 ox = floor(x + 0.5);
  vec3 a0 = x - ox;
  m *= 1.79284291400159 - 0.85373472095314 * (a0 * a0 + h * h);
  vec3 g;
  g.x = a0.x * x0.x + h.x * x0.y;
  g.yz = a0.yz * x12.xz + h.yz * x12.yw;
  return 130.0 * dot(m, g);
}

float smootherstep(float edge0, float edge1, float x) {
  float t = clamp((x - edge0) / (edge1 - edge0), 0.0, 1.0);
  return t * t * t * (t * (t * 6.0 - 15.0) + 10.0);
}

vec3 oklabToLinear(vec3 c) {
  float l = c.x + 0.3963377774 * c.y + 0.2158037573 * c.z;
  float m = c.x - 0.1055613458 * c.y - 0.0638541728 * c.z;
  float s = c.x - 0.0894841775 * c.y - 1.2914855480 * c.z;
  l = l * l * l;
  m = m * m * m;
  s = s * s * s;
  return vec3(
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s
  );
}

vec3 toSrgb(vec3 c) {
  c = clamp(c, 0.0, 1.0);
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}

vec3 ramp(float t) {
  float x = clamp(t, 0.0, 1.0) * float(uStopCount - 1);
  int i = int(min(floor(x), float(uStopCount - 2)));
  float f = x - float(i);
  f = f * f * (3.0 - 2.0 * f);
  vec3 lch = mix(uStops[i], uStops[i + 1], f);
  lch.x = mix(lch.x, min(lch.x, 0.7), uLightMode);
  return toSrgb(oklabToLinear(vec3(lch.x, lch.y * cos(lch.z), lch.y * sin(lch.z))));
}

float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

void main() {
  vec2 frag = gl_FragCoord.xy;
  float y = 1.0 - frag.y / uResolution.y;
  y = mix(y, 1.0 - y, uFlip);
  float u = frag.x / uResolution.x;
  float X = (frag.x - uResolution.x * 0.5) / uResolution.y;
  float t = uTime;
  float reach = uPointer.z * exp(-pow((X - uPointer.x) / 0.38, 2.0));

  vec3 glow = vec3(0.0);
  float cover = 0.0;
  for (int k = 0; k < ${o}; k++) {
    if (k >= uLayers) break;
    float layer = float(k);
    float seed = layer * 13.7;
    float pace = t * (1.0 - layer * 0.18);
    float warp = snoise(vec2(X * 0.45 * uScale + pace * 0.02 + seed, pace * 0.05 + seed));
    float wave = snoise(vec2(X * 0.75 * uScale + warp * 0.35 - pace * 0.03 + seed, pace * 0.07 - seed)) * 0.72
      + snoise(vec2(X * 1.6 * uScale + warp * 0.5 + pace * 0.04 - seed, pace * 0.1 + seed * 0.5)) * 0.28;
    float hem = uHeight + layer * 0.07 + wave * 0.15 * uAmplitude;
    hem += reach * 0.08 * (layer < 0.5 ? 1.0 : 0.4);
    hem = mix(-0.25, hem, uReveal);

    float soft = (0.04 + uBlend * 0.16) * (1.0 + layer * 0.9);
    float rise = hem - y;
    float low = -soft - uGlow * 0.14;
    float high = 0.26 + soft * 0.6;
    float body = pow(smootherstep(low, high, rise), 1.5 + uGlow * 0.6);
    float lobes = 0.86 + 0.14 * snoise(vec2(X * 0.9 * uScale - pace * 0.025 + seed, y * 0.3 + pace * 0.04));
    float alpha = body * lobes * (layer < 0.5 ? 1.0 : 0.32 / layer);
    alpha = clamp(alpha * (1.0 + reach * 0.25 * smootherstep(0.9, 0.0, abs(y - hem))), 0.0, 1.0);

    vec3 tint = ramp(u + 0.05 * sin(pace * 0.08 + layer * 2.3) + layer * 0.1 + max(rise, 0.0) * 0.05);
    glow = 1.0 - (1.0 - glow) * (1.0 - tint * alpha);
    cover = 1.0 - (1.0 - cover) * (1.0 - alpha);
  }

  float fade = smootherstep(0.0, 0.7, uReveal) * uOpacity;
  float strength = clamp(uBrightness, 0.0, 2.0);
  glow *= fade * min(strength, 1.0);
  cover *= fade * min(strength, 1.0);
  glow = 1.0 - pow(1.0 - glow, vec3(max(strength, 1.0)));
  float dither = (hash(frag) - 0.5) / 255.0;

  if (uLightMode > 0.5) {
    vec3 tint = cover > 0.0001 ? glow / cover : vec3(0.0);
    cover *= smootherstep(0.0, 0.25, cover);
    float alpha = cover * 0.7;
    outColor = vec4(tint * alpha + dither, clamp(alpha + dither, 0.0, 1.0));
    return;
  }
  outColor = vec4(glow + dither, clamp(cover + dither, 0.0, 1.0));
}`,u=(e,t,n)=>Math.min(n,Math.max(t,e)),d=e=>{let[t,n,r]=e.map(e=>e<=.04045?e/12.92:((e+.055)/1.055)**2.4),i=Math.cbrt(.4122214708*t+.5363325363*n+.0514459929*r),a=Math.cbrt(.2119034982*t+.6806995451*n+.1073969566*r),o=Math.cbrt(.0883024619*t+.2817188376*n+.6299787005*r),s=[.2104542553*i+.793617785*a-.0040720468*o,1.9779984951*i-2.428592205*a+.4505937099*o,.0259040371*i+.7827717662*a-.808675766*o];return[s[0],Math.hypot(s[1],s[2]),Math.atan2(s[2],s[1])]},f=e=>{let t=e.findIndex(e=>e[1]>.02),n=t===-1?0:e[t][2];return e.map(e=>{let t=e[1]>.02?e[2]:n;for(;t-n>Math.PI;)t-=Math.PI*2;for(;t-n<-Math.PI;)t+=Math.PI*2;return n=t,[e[0],e[1],t]})},p=(e,t,n)=>{let r=e.createShader(t);return r?(e.shaderSource(r,n),e.compileShader(r),e.getShaderParameter(r,e.COMPILE_STATUS)?r:(e.deleteShader(r),null)):null},m=e=>{let t=p(e,e.VERTEX_SHADER,c),n=p(e,e.FRAGMENT_SHADER,l),r=e.createProgram();if(!t||!n||!r)return null;if(e.attachShader(r,t),e.attachShader(r,n),e.bindAttribLocation(r,0,`aPosition`),e.linkProgram(r),e.deleteShader(t),e.deleteShader(n),!e.getProgramParameter(r,e.LINK_STATUS))return e.deleteProgram(r),null;let i={},a=e.getProgramParameter(r,e.ACTIVE_UNIFORMS);for(let t=0;t<a;t++){let n=e.getActiveUniform(r,t);n&&(i[n.name.replace(`[0]`,``)]=e.getUniformLocation(r,n.name))}return{program:r,uniforms:i}},h=({colorStops:e=[`#5227FF`,`#7cff67`,`#5227FF`],amplitude:t=1,blend:n=.5,speed:c=1,time:l,height:p=.45,scale:h=1,glow:g=.6,brightness:_=1,layers:v=1,direction:y=`top`,mouseInteraction:b=!0,intro:x=!0,opacity:S=1,lightMode:C=!1,paused:w=!1,dpr:T,className:E=``,style:D})=>{let O=(0,r.useRef)(null),k=(0,r.useRef)(null),A=(0,r.useRef)(null),j=(Array.isArray(e)?e:[]).filter(Boolean).map(String).slice(0,a),M={stops:j.length>=2?j:j.length===1?[j[0],j[0]]:[`#5227FF`,`#7cff67`],amplitude:Math.max(0,t),blend:u(n,0,1),speed:c,time:l,height:u(p,0,1),scale:Math.max(.1,h),glow:Math.max(0,g),brightness:Math.max(0,_),layers:u(Math.round(v),1,o),flip:+(y===`bottom`),mouseInteraction:b,intro:x,opacity:u(S,0,1),lightMode:C,paused:w,dpr:T},N=(0,r.useRef)(M);return N.current=M,(0,r.useEffect)(()=>{let e=O.current,t=k.current,n=t?.getContext(`webgl2`,{alpha:!0,premultipliedAlpha:!0,antialias:!1,depth:!1,stencil:!1});if(!e||!t||!n)return;let r=m(n);if(!r)return;let i=r.uniforms,a=n.createBuffer(),o=n.createVertexArray();n.bindVertexArray(o),n.bindBuffer(n.ARRAY_BUFFER,a),n.bufferData(n.ARRAY_BUFFER,new Float32Array([-1,-1,3,-1,-1,3]),n.STATIC_DRAW),n.enableVertexAttribArray(0),n.vertexAttribPointer(0,2,n.FLOAT,!1,0,0);let c=document.createElement(`canvas`).getContext(`2d`,{willReadFrequently:!0}),l=window.matchMedia?.(`(prefers-reduced-motion: reduce)`).matches??!1,p=new Map,h=e=>{let t=p.get(e);if(t)return t;let n=[1,1,1];if(c){c.clearRect(0,0,1,1),c.fillStyle=`#ffffff`,c.fillStyle=e,c.fillRect(0,0,1,1);let[t,r,i]=c.getImageData(0,0,1,1).data;n=[t/255,r/255,i/255]}return p.set(e,n),n},g=new Float32Array(15),_={width:1,height:1},v={x:0,y:0,inside:!1},y={clock:0,px:0,py:.5,reach:0,reveal:N.current.intro&&!l?0:1},b=0,x=0,S=!0,C=()=>{let e=N.current;f(e.stops.map(e=>d(h(e)))).forEach((e,t)=>g.set(e,t*3));let a=y.reveal;n.viewport(0,0,t.width,t.height),n.useProgram(r.program),n.bindVertexArray(o),n.uniform2f(i.uResolution,t.width,t.height),n.uniform1f(i.uTime,e.time===void 0?y.clock:e.time*e.speed*.1),n.uniform3fv(i.uStops,g),n.uniform1i(i.uStopCount,e.stops.length),n.uniform1f(i.uAmplitude,e.amplitude),n.uniform1f(i.uBlend,e.blend),n.uniform1f(i.uHeight,e.height),n.uniform1f(i.uScale,e.scale),n.uniform1f(i.uGlow,e.glow),n.uniform1f(i.uBrightness,e.brightness),n.uniform1i(i.uLayers,e.layers),n.uniform1f(i.uFlip,e.flip),n.uniform3f(i.uPointer,y.px,y.py,y.reach),n.uniform1f(i.uReveal,1-(1-a)**3),n.uniform1f(i.uOpacity,e.opacity),n.uniform1f(i.uLightMode,+!!e.lightMode),n.drawArrays(n.TRIANGLES,0,3)},w=e=>{if(b=0,!S||document.hidden)return;let t=N.current,n=x?u((e-x)/1e3,5e-4,.05):1/60;if(x=e,t.paused){y.reveal=1,C(),x=0;return}let r=+!l;y.clock+=n*t.speed*r;let i=t.mouseInteraction&&v.inside&&!l,a=1-Math.exp(-n/.6);if(i){let e=(v.x-_.width/2)/_.height,n=t.flip?1-v.y/_.height:v.y/_.height;y.px+=(e-y.px)*a,y.py+=(n-y.py)*a}y.reach+=(+!!i-y.reach)*(1-Math.exp(-n/(i?.9:1.4))),!t.intro||l?y.reveal=1:y.reveal<1&&(y.reveal=Math.min(1,y.reveal+n/s)),C(),b=requestAnimationFrame(w)},T=()=>{!b&&S&&!document.hidden&&(b=requestAnimationFrame(w))},E=()=>{let n=N.current,r=Math.max(1,e.clientWidth),i=Math.max(1,e.clientHeight),a=Math.min(n.dpr||window.devicePixelRatio||1,2);_.width=r,_.height=i,t.width=Math.max(1,Math.round(r*a)),t.height=Math.max(1,Math.round(i*a)),C(),T()},D=t=>{let n=e.getBoundingClientRect();v.x=t.clientX-n.left,v.y=t.clientY-n.top;let r=v.inside;if(v.inside=v.x>=0&&v.y>=0&&v.x<=n.width&&v.y<=n.height,v.inside&&!r){let e=N.current;y.px=(v.x-n.width/2)/Math.max(1,n.height),y.py=e.flip?1-v.y/Math.max(1,n.height):v.y/Math.max(1,n.height)}N.current.paused||T()},j=e=>{e.pointerType!==`mouse`&&(v.inside=!1)},M=()=>{v.inside=!1},P=()=>{x=0,T()},F=new ResizeObserver(E);F.observe(e);let I=new IntersectionObserver(e=>{S=e.some(e=>e.isIntersecting),S&&(x=0,T())});I.observe(e),window.addEventListener(`pointermove`,D,{passive:!0}),window.addEventListener(`pointerdown`,D,{passive:!0}),window.addEventListener(`pointerup`,j,{passive:!0}),window.addEventListener(`pointercancel`,j,{passive:!0}),document.documentElement.addEventListener(`pointerleave`,M),document.addEventListener(`visibilitychange`,P),E();let L=N.current.dpr;return A.current=()=>{let e=N.current;e.dpr===L?(b||C(),T()):(L=e.dpr,E())},()=>{cancelAnimationFrame(b),A.current=null,F.disconnect(),I.disconnect(),window.removeEventListener(`pointermove`,D),window.removeEventListener(`pointerdown`,D),window.removeEventListener(`pointerup`,j),window.removeEventListener(`pointercancel`,j),document.documentElement.removeEventListener(`pointerleave`,M),document.removeEventListener(`visibilitychange`,P),n.deleteProgram(r.program),n.deleteBuffer(a),n.deleteVertexArray(o),n.getExtension(`WEBGL_lose_context`)?.loseContext()}},[]),(0,r.useEffect)(()=>{A.current?.()}),(0,i.jsx)(`div`,{ref:O,className:`aurora-container${E?` ${E}`:``}`,style:D,children:(0,i.jsx)(`canvas`,{ref:k,className:`aurora-canvas`,"aria-hidden":`true`})})};export{h as default};