(function(){
'use strict';
var stage=document.getElementById('stage');
var H=40;               // world height of ratio = 1
var cur={fire:'dixie',pal:'green', enc:'alpha', w:.8,year:2022,sev:{1:true,2:true,3:true},nf:true,r1:true};

//choose fire
var FIRES={
  dixie:{name:'Dixie Fire',         file:'/cells_dixie.json', ignition:'July 14, 2021'},
  north:{name:'North Complex Fire', file:'/cells_north.json', ignition:'August 17, 2020'}
};
var cache={};

var ENC={ //various encoding for severity to play around with
  alpha:  {1:{op:1,  wire:false,n:1}, 2:{op:.55,wire:false,n:1}, 3:{op:.2, wire:false,n:1}},
  //wire:   {1:{op:1,  wire:false,n:1}, 2:{op:0.9,  wire:true, n:3}, 3:{op:.3,wire:true, n:1}},
  
  wire:  {1:{op:1,  wire:false,n:1},
         2:{op:1,  wire:true, n:1, clean:true, rings:8, cols:2},
         //3:{op:.35,wire:true, n:1, clean:true, rings:0}},
         3:{op:1, wire:true, n:1, clean:true, rings:0, fill:.65}},
  density:{1:{op:1,  wire:true, n:4}, 2:{op:1,  wire:true, n:2}, 3:{op:1,  wire:true, n:1}}
};
var LEG={ //which encoding?
  alpha:  ['High (solid)','Moderate (half transparent)','Low (mostly transparent)'],
  wire:   ['High (solid mesh)','Moderate (wireframe)','Low (faint wireframe)'],
  density:['High (dense wireframe)','Moderate (medium wireframe)','Low (sparse wireframe)']
};

var D=null,Y=null,scene,camera,renderer,controls,meshes=[],cellsByMesh=[],extras=[],gridGroup,nfLine,r1Line,raycaster=new THREE.Raycaster(),mouse=new THREE.Vector2();

//two color options to play around with 
var PALETTES={
  green:  [[0,'#DBE9B4'],[.35,'#8FC16A'],[.65,'#3F9A45'],[1,'#0B5A32']],
  heat: [[0,'#D9480F'],[.33,'#F5D431'],[.66,'#8FD16A'],[1,'#0B5A32']],   // orange, yellow, light green, dark green  // orange -> yellow -> two kinds of green
};
Object.keys(PALETTES).forEach(function(k){
  PALETTES[k]=PALETTES[k].map(function(s){return [s[0],new THREE.Color(s[1])]});
});
var STOPS_CSS={
  green:'#DBE9B4,#8FC16A 35%,#3F9A45 65%,#0B5A32',
  heat: '#D9480F,#F5D431 33%,#8FD16A 66%,#0B5A32'
};
function ramp(t){
  var R=PALETTES[cur.pal];
  t=Math.max(0,Math.min(1,t));
  for(var i=1;i<R.length;i++){
    if(t<=R[i][0]){var a=R[i-1],b=R[i],u=(t-a[0])/(b[0]-a[0]);return a[1].clone().lerp(b[1],u);}
  }
  return R[R.length-1][1].clone();
}

function edgeLines(cs,m,rp,op,rings,cols){
  var E=[[0,0,0,1,0,0],[1,0,0,1,0,1],[1,0,1,0,0,1],[0,0,1,0,0,0],
         [0,1,0,1,1,0],[1,1,0,1,1,1],[1,1,1,0,1,1],[0,1,1,0,1,0],
         [0,0,0,0,1,0],[1,0,0,1,1,0],[1,0,1,1,1,1],[0,0,1,0,1,1]];
  for(var j=1;j<=rings;j++){var f=j/(rings+1);
    E.push([0,f,0,1,f,0],[1,f,0,1,f,1],[1,f,1,0,f,1],[0,f,1,0,f,0]);}
  for(var j=1;j<=(cols||0);j++){var f=j/(cols+1);   // extra vertical lines on each of the 4 faces
          E.push([f,0,0,f,1,0],[f,0,1,f,1,1],[0,0,f,0,1,f],[1,0,f,1,1,f]);}
  var pos=[],col=[];
  cs.forEach(function(c){
    var hh=Math.max(.15,c.sr_plot*H),x0=c.ix+.5-cur.w/2,z0=(m.grid.ny-1-c.iy)+.5-cur.w/2;
    var k=ramp((c.nr-rp[0])/(rp[1]-rp[0]));
    E.forEach(function(e){for(var i=0;i<2;i++){
      pos.push(x0+e[i*3]*cur.w,e[i*3+1]*hh,z0+e[i*3+2]*cur.w);col.push(k.r,k.g,k.b);}});
  });
  var g=new THREE.BufferGeometry();
  g.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));
  g.setAttribute('color',new THREE.Float32BufferAttribute(col,3));
  var L=new THREE.LineSegments(g,new THREE.LineBasicMaterial({vertexColors:true,transparent:op<1,opacity:op}));
  L.renderOrder=1;return L;
}

function $(id){return document.getElementById(id)}
function dark(){var r=document.documentElement.getAttribute('data-theme');return r?r==='dark':window.matchMedia('(prefers-color-scheme:dark)').matches}


//load the actual data
function loadData(key){
  if(cache[key])return Promise.resolve(cache[key]);
  return fetch(FIRES[key].file).then(function(r){return r.json()}).then(function(d){cache[key]=d;return d});
}
loadData(cur.fire).then(function(d){D=d;init();}).catch(function(e){
  stage.insertAdjacentHTML('beforeend','<div id="nodata" style="display:flex">Could not load the data file ('+e.message+'). Serve this folder over http, not file://.</div>')});

//add ignition date
function setIgnition(){$('ign').innerHTML='<b>Ignition:</b> '+FIRES[cur.fire].ignition}

function init(){
  var m=D.meta,g=m.grid;
  scene=new THREE.Scene();
  var w=stage.clientWidth,h=stage.clientHeight;
  var span=Math.max(g.nx,g.ny);
  camera=new THREE.OrthographicCamera(-w/h*span*.6,w/h*span*.6,span*.6,-span*.6,-1000,1000);
  //camera.position.set(g.nx*1.0,g.nx*0.9,-g.ny*0.6+g.ny); 
  camera.position.set(g.nx*.5+90,110,g.ny*.5+110);
  renderer=new THREE.WebGLRenderer({antialias:true,alpha:true});
  renderer.setPixelRatio(Math.min(window.devicePixelRatio||1,2));
  renderer.setSize(w,h);stage.appendChild(renderer.domElement);
  var cx=g.nx/2,cz=g.ny/2;
  controls=new THREE.OrbitControls(camera,renderer.domElement);
  controls.target.set(cx,H*.4,cz);controls.enableDamping=true;controls.dampingFactor=.08;controls.screenSpacePanning=true;
  controls.minZoom=.5;controls.maxZoom=14;camera.zoom=1.4;camera.updateProjectionMatrix();controls.maxPolarAngle=Math.PI/2.02;
  camera.lookAt(controls.target);controls.update();
  scene.add(new THREE.AmbientLight(0xffffff,.75));
  var dl=new THREE.DirectionalLight(0xffffff,.6);dl.position.set(-40,100,60);scene.add(dl);
  buildBase();buildLines();buildSlider();buildPanel();
  stage.insertAdjacentHTML('beforeend','<div class="lbl" id="nf-l">noise floor (R = '+(1-m.rh95_floor).toFixed(2)+')</div><div class="lbl" id="r1-l">R = 1 (no change)</div><div id="tip"></div><div id="nodata"></div>');
  setIgnition();
  setYear(cur.year);
  window.addEventListener('resize',onResize);
  stage.addEventListener('pointermove',onMove);stage.addEventListener('pointerleave',function(){$('tip').style.display='none'});
  document.getElementById('reset').addEventListener('click',function(){var g=D.meta.grid,cx=g.nx/2,cz=g.ny/2;camera.position.set(cx+90,110,cz+110);camera.zoom=1.4;camera.updateProjectionMatrix();controls.target.set(cx,H*.4,cz);controls.update()});
  var mq=window.matchMedia('(prefers-color-scheme:dark)');if(mq.addEventListener)mq.addEventListener('change',recolorScene);
  recolorScene();animate();
}
function recolorScene(){var d=dark();if(gridGroup){gridGroup.children.forEach(function(o){o.material.color.set(d?0x4a5560:0x9aa3ae)})}if(r1Line)r1Line.material.color.set(d?0xe6eaf0:0x1f2a37)}
function buildBase(){
  if(gridGroup)scene.remove(gridGroup);
  var g=D.meta.grid;gridGroup=new THREE.Group();
  var pts=[],step=10;
  for(var x=0;x<=g.nx;x+=step){pts.push(x,0,0,x,0,g.ny)}
  for(var z=0;z<=g.ny;z+=step){pts.push(0,0,z,g.nx,0,z)}
  var geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute(pts,3));
  gridGroup.add(new THREE.LineSegments(geo,new THREE.LineBasicMaterial({color:0x9aa3ae,transparent:true,opacity:.6})));
  scene.add(gridGroup);
  buildAxis();
}
function rect(y,mat){var g=D.meta.grid,p=[0,y,0,g.nx,y,0,g.nx,y,g.ny,0,y,g.ny,0,y,0];var geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute(p,3));var l=new THREE.Line(geo,mat);l.computeLineDistances();return l}
function buildLines(){
  if(nfLine)scene.remove(nfLine);if(r1Line)scene.remove(r1Line);
  var m=D.meta;
  nfLine=rect(m.noise_floor_plane_z*H,new THREE.LineDashedMaterial({color:0xD9480F,dashSize:4,gapSize:3}));
  r1Line=rect(m.r1_plane_z*H,new THREE.LineDashedMaterial({color:0x1f2a37,dashSize:4,gapSize:3}));
  scene.add(nfLine);scene.add(r1Line);
}
function buildSlider(){
  var s=D.meta.slider,el=$('yr'),tk=$('ticks');
  el.min=0;el.max=s.length-1;el.step=1;el.value=0;
  tk.innerHTML=s.map(function(x){return '<span>'+x.year+'</span>'}).join('');
  el.oninput=function(){setYear(s[+el.value].year)};
}

function buildPanel(){
  // column width slider
  var wi=$('cw');wi.value=cur.w;$('cwv').textContent=cur.w.toFixed(2)+'×';
  wi.addEventListener('input',function(){cur.w=+wi.value;$('cwv').textContent=cur.w.toFixed(2)+'×';rebuild()});

  //fire toggle
  $('fire').addEventListener('change',function(e){switchFire(e.target.value)});

  // color palette toggle
  ['green','heat'].forEach(function(k){
    $('pal-'+k).addEventListener('change',function(e){
      if(!e.target.checked)return;
      cur.pal=k;
      $('ramp').style.background='linear-gradient(90deg,'+STOPS_CSS[k]+')';
      rebuild();
    });
  });

  // severity encoding toggle (separate loop, not inside the one above)
  ['alpha','wire','density'].forEach(function(k){
    $('enc-'+k).addEventListener('change',function(e){
      if(!e.target.checked)return;
      cur.enc=k;
      [1,2,3].forEach(function(t){$('sevtxt'+t).textContent=LEG[k][t-1]});
      rebuild();
    });
  });

  // severity checkboxes
  [1,2,3].forEach(function(t){$('sev'+t).addEventListener('change',function(e){cur.sev[t]=e.target.checked;rebuild()})});

  // reference line toggles
  $('tgNf').addEventListener('change',function(e){cur.nf=e.target.checked;nfLine.visible=cur.nf;$('nf-l').style.display=cur.nf?'block':'none'});
  $('tgR1').addEventListener('change',function(e){cur.r1=e.target.checked;r1Line.visible=cur.r1;$('r1-l').style.display=cur.r1?'block':'none'});

  // legend numbers under the color ramp
  var m=D.meta;
  $('rampMin').textContent=m.ndvi_ramp[0].toFixed(1);
  $('rampMax').textContent=m.ndvi_ramp[1].toFixed(1);
  $('rampMid').textContent=((m.ndvi_ramp[0]+m.ndvi_ramp[1])/2).toFixed(1);
}

var axis=[];
  function buildAxis(){//builds the axes and adds the lat and long labels
    axis.forEach(function(a){a.el.remove()});axis=[];
    var g=D.meta.grid,NLON=4,NLAT=4;   // how many labels on each axis
    function add(txt,v,cls){var el=document.createElement('div');el.className='lbl ax '+cls;el.textContent=txt;stage.appendChild(el);axis.push({el:el,v:v})}
    for(var i=0;i<NLON;i++){
      var x=(.06+.88*i/(NLON-1))*g.nx,L=g.lon0+(x-.5)/120;
      add(Math.abs(L).toFixed(2)+'°W',new THREE.Vector3(x,0,g.ny),'ax-x');
    }
    for(var j=0;j<NLAT;j++){
      var z=(.06+.88*j/(NLAT-1))*g.ny,A=g.lat0+(g.ny-z-.5)/120;
      add(A.toFixed(2)+'°N',new THREE.Vector3(g.nx,0,z),'ax-z');
    }
  }

function setYear(y){
  cur.year=y;var s=D.meta.slider.filter(function(x){return x.year===y})[0];
  $('yrLabel').textContent=y+' · '+s.years_since_fire+' yr after fire';
  $('yr').value=D.meta.slider.indexOf(s);
  var nd=$('nodata');
  if(!s.has_data){nd.style.display='flex';nd.textContent=y+': '+(s.note||'no data')+'. '+FIRES[cur.fire].name+' has no usable summer GEDI data this year, so no columns are drawn.'}else nd.style.display='none';
  rebuild();stats();
}

//change the fire using the toggle
function switchFire(key){
  loadData(key).then(function(d){
    D=d;cur.fire=key;
    var g=D.meta.grid,cx=g.nx/2,cz=g.ny/2;
    buildBase();buildLines();buildSlider();
    nfLine.visible=cur.nf;r1Line.visible=cur.r1;recolorScene();
    $('nf-l').textContent='noise floor (R = '+(1-D.meta.rh95_floor).toFixed(2)+')';
    onResize();
    camera.position.set(cx+90,110,cz+110);camera.zoom=1.4;camera.updateProjectionMatrix();
    controls.target.set(cx,H*.4,cz);controls.update();
    setIgnition();
    setYear(D.meta.slider.filter(function(s){return s.has_data})[0].year);
  });
}

function rebuild(){
  meshes.forEach(function(m){scene.remove(m);m.geometry.dispose();m.material.dispose()});meshes=[];cellsByMesh=[];
  extras.forEach(function(o){scene.remove(o);o.geometry.dispose();o.material.dispose()});extras=[];
  var m=D.meta,rp=m.ndvi_ramp;
  [1,2,3].forEach(function(t){
    if(!cur.sev[t])return;
    var cs=D.cells.filter(function(c){return c.year===cur.year&&c.tier===t});
    if(!cs.length)return;
    var st=ENC[cur.enc][t];
    var clean=!!st.clean;   // clean outline (+ rings) instead of a three.js wireframe
    var geo=new THREE.BoxGeometry(1,1,1,st.n,st.n,st.n);geo.translate(0,.5,0);
    var mat=clean
      ? new THREE.MeshBasicMaterial({colorWrite:!!st.fill,transparent:!!st.fill,opacity:st.fill||1,polygonOffset:true,polygonOffsetFactor:1,polygonOffsetUnits:1})
      : st.wire
        ? new THREE.MeshBasicMaterial({wireframe:true,transparent:st.op<1,opacity:st.op})
        : new THREE.MeshLambertMaterial({transparent:st.op<1,opacity:st.op,depthWrite:st.op===1});
    var im=new THREE.InstancedMesh(geo,mat,cs.length),dm=new THREE.Object3D();
    cs.forEach(function(c,i){
      var hh=Math.max(.15,c.sr_plot*H);
      dm.position.set(c.ix+.5,0,(m.grid.ny-1-c.iy)+.5);dm.scale.set(cur.w,hh,cur.w);dm.updateMatrix();im.setMatrixAt(i,dm.matrix);
      im.setColorAt(i,ramp((c.nr-rp[0])/(rp[1]-rp[0])));
    });
    im.instanceMatrix.needsUpdate=true;if(im.instanceColor)im.instanceColor.needsUpdate=true;
    im.renderOrder=st.wire?1:0;
    scene.add(im);meshes.push(im);cellsByMesh.push(cs);
    if(clean){var L=edgeLines(cs,m,rp,st.op,st.rings||0,st.cols||0);scene.add(L);extras.push(L);}
  });
}

function stats(){
  var s=D.meta.summary&&D.meta.summary[cur.year];var el=$('stats');
  if(!s){el.innerHTML='<span class="stat">No usable data this year.</span>';return}
  
  var cs=D.cells.filter(function(c){return c.year===cur.year});
  var nb=cs.filter(function(c){return c.struct_beyond}).length;
  var pct=cs.length?Math.round(100*nb/cs.length):0;

  function share(t){
    var a=cs.filter(function(c){return c.tier===t});
    var b=a.filter(function(c){return c.struct_beyond}).length;
    return a.length?Math.round(100*b/a.length)+'%':'–';
  }

  el.innerHTML='<div class="stat"><b>'+s.burned_cells+'</b> burned cells · <b>'+s.reference_cells+'</b> reference cells</div>'+
  '<div class="stat">Median structural ratio (burned): <b>'+(+s.median_sr||0).toFixed(2)+'</b></div>'+
  '<div class="stat">Median NDVI ratio (burned): <b>'+(+s.median_nr||0).toFixed(2)+'</b></div>'+
  '<div class="stat">Noise floor: <b>'+(1-D.meta.rh95_floor).toFixed(2)+'</b> (structure ratio below this is beyond GEDI sampling noise)</div>'+
  '<div class="stat"><b>'+pct+'%</b> of burned cells ('+nb+' of '+cs.length+') show real structural loss</div>'+
  '<div class="stat">By severity: high <b>'+share(1)+'</b> · moderate <b>'+share(2)+'</b> · low <b>'+share(3)+'</b></div>';
}

function cellKm(lat){var h=111.2/120,w=h*Math.cos(lat*Math.PI/180);return [w,h,w*h]} //this is an approximation

function onMove(e){
  if(!meshes.length)return;
  var r=renderer.domElement.getBoundingClientRect();
  mouse.x=((e.clientX-r.left)/r.width)*2-1;mouse.y=-((e.clientY-r.top)/r.height)*2+1;
  raycaster.setFromCamera(mouse,camera);
  var hit=raycaster.intersectObjects(meshes,false)[0],tip=$('tip');
  if(!hit||hit.instanceId==null){tip.style.display='none';return}
  var c=cellsByMesh[meshes.indexOf(hit.object)][hit.instanceId];
  tip.innerHTML='<b>'+c.sev+' severity</b><br>Structural ratio: '+c.sr.toFixed(2)+(c.clipped?' (clipped in plot)':'')+(c.struct_beyond?' · beyond floor':' · inside floor')+'<br>NDVI ratio: '+c.nr.toFixed(2);
  tip.style.display='block';var sr=stage.getBoundingClientRect();
  tip.style.left=Math.min(e.clientX-sr.left+14,sr.width-240)+'px';tip.style.top=Math.max(4,e.clientY-sr.top+14)+'px';
  
  //for the lat/long labels
  var c=cellsByMesh[meshes.indexOf(hit.object)][hit.instanceId],k=cellKm(c.lat);
  tip.innerHTML='<b>'+c.sev+' severity</b><br>Structural ratio: '+c.sr.toFixed(2)+(c.clipped?' (clipped in plot)':'')+(c.struct_beyond?' · beyond floor':' · inside floor')+'<br>NDVI ratio: '+c.nr.toFixed(2)
    +'<br> Cell Center: '+Math.abs(c.lat).toFixed(3)+'°N, '+Math.abs(c.lon).toFixed(3)+'°W'
    +'<br>Cell spans '+k[0].toFixed(2)+' × '+k[1].toFixed(2)+' km ('+k[2].toFixed(2)+' km²)';
}
function proj(v){var p=v.clone().project(camera);var w=stage.clientWidth,h=stage.clientHeight;return [(p.x*.5+.5)*w,(-p.y*.5+.5)*h]}
function placeLabels(){
  var g=D.meta.grid,a=proj(new THREE.Vector3(g.nx,D.meta.noise_floor_plane_z*H,0)),b=proj(new THREE.Vector3(g.nx,D.meta.r1_plane_z*H,0));
  var n=$('nf-l'),r=$('r1-l');n.style.left=a[0]+'px';n.style.top=a[1]+'px';r.style.left=b[0]+'px';r.style.top=b[1]+'px';
  axis.forEach(function(a){var p=proj(a.v);a.el.style.left=p[0]+'px';a.el.style.top=p[1]+'px'});
}
function onResize(){
  var w=stage.clientWidth,h=stage.clientHeight,span=Math.max(D.meta.grid.nx,D.meta.grid.ny);
  camera.left=-w/h*span*.6;camera.right=w/h*span*.6;camera.top=span*.6;camera.bottom=-span*.6;camera.updateProjectionMatrix();renderer.setSize(w,h);
}
function animate(){requestAnimationFrame(animate);controls.update();renderer.render(scene,camera);placeLabels()}
})();
