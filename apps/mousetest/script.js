(() => {
  function drawSpacedText(ctx, text, x, y, spacing) {
    ctx.save();
    ctx.textAlign = 'center';
    const widths = text.split('').map(ch => ctx.measureText(ch).width);
    const totalWidth = widths.reduce((a,b)=>a+b,0) + spacing*(text.length-1);
    let startX = x - totalWidth/2;
    for (let i=0; i<text.length; i++) {
      ctx.fillText(text[i], startX + widths[i]/2, y);
      startX += widths[i] + spacing;
    }
    ctx.restore();
  }

  const bg = document.getElementById('bg');
  const overlay = document.getElementById('overlay');
  const octx = overlay.getContext('2d');
  const binsDiv = document.getElementById('bins');
  let isLocked=false, yaw=0, pitch=0, lastTime=null, startTime=null;
  const samples=[], particles=[], laserBeams=[];
  let binRanges=[], activeBeam=null;
  let fpsCounter=0, fpsTime=0, currentFps=0;
  let score=0;
  let gameStartTime=null, showInstructions=true;
  let testMode=false;
  
  // Mobile detection
  const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) || 
                   (window.innerWidth <= 768 && window.innerHeight <= 1024);

  // Add mobile class to body if mobile detected
  if (isMobile) {
    document.body.classList.add('mobile');
  }
  
  document.addEventListener('pointerlockchange', ()=>{
    isLocked = document.pointerLockElement === bg;
    document.body.classList.toggle('locked', isLocked);
    if (isLocked && gameStartTime === null) {
      gameStartTime = performance.now();
    }
  });
  
  // Only add click handlers if not mobile
  if (!isMobile) {
    bg.addEventListener('click', ()=>{ if(!isLocked) bg.requestPointerLock(); });
    // also allow clicking the overlay to capture the mouse
    overlay.addEventListener('click', ()=>{ if(!isLocked) bg.requestPointerLock(); });
  }
  
  document.addEventListener('keydown', e=>{ 
    if(e.code==='Escape'&&isLocked) document.exitPointerLock();
    if(e.code==='KeyX') {
      testMode = !testMode;
      console.log('Test mode:', testMode ? 'ON' : 'OFF');
    }
  });

  function resize() {
    const w=innerWidth, h=innerHeight;
    bg.width=w; overlay.width=w;
    bg.height=h; overlay.height=h;
    renderer.setSize(w,h);
    camera.aspect=w/h;
    camera.updateProjectionMatrix();
  }
  window.addEventListener('resize', resize);

  const renderer=new THREE.WebGLRenderer({canvas:bg,antialias:true});
  const scene=new THREE.Scene(); scene.background=new THREE.Color(0x10131b);
  const camera=new THREE.PerspectiveCamera(60,innerWidth/innerHeight,0.1,2000);
  camera.position.z=100;
  renderer.setSize(innerWidth,innerHeight);
  scene.add(new THREE.AmbientLight(0x404040));
  const dir=new THREE.DirectionalLight(0xffffff,1);
  dir.position.set(0.5,1,1);
  scene.add(dir);

  const starGeo=new THREE.BufferGeometry();
  const starCount=2000;
  const starPos=new Float32Array(starCount*3);
  for(let i=0;i<starCount;i++){
    starPos[3*i]=(Math.random()-0.5)*2000;
    starPos[3*i+1]=(Math.random()-0.5)*2000;
    starPos[3*i+2]=(Math.random()-0.5)*2000;
  }
  starGeo.setAttribute('position',new THREE.BufferAttribute(starPos,3));
  const stars=new THREE.Points(starGeo,new THREE.PointsMaterial({color:0x30ff62,size:2}));
  scene.add(stars);

  const geoms=[
    new THREE.BoxGeometry(8,8,8),
    new THREE.SphereGeometry(5,32,32),
    new THREE.TorusGeometry(5,2,16,100),
    new THREE.ConeGeometry(6,12,32),
    new THREE.TorusKnotGeometry(4,1.5,100,16),
    new THREE.IcosahedronGeometry(5)
  ];
  const shapes=[];
  for(let i=0;i<100;i++){
    const g=geoms[Math.floor(Math.random()*geoms.length)];
    const m=new THREE.Mesh(g,new THREE.MeshStandardMaterial({color:0x30ff62,wireframe:true}));
    m.position.set((Math.random()-0.5)*400,(Math.random()-0.5)*400,(Math.random()-0.5)*400);
    m.userData.vel=new THREE.Vector3((Math.random()-0.5),(Math.random()-0.5),(Math.random()-0.5));
    scene.add(m);
    shapes.push(m);
  }

  for(let i=0;i<9;i++){
    const box=document.createElement('div');box.className='binBox';
    const lbl=document.createElement('div');lbl.className='label';box.append(lbl);
    const cnt=document.createElement('div');cnt.className='count';cnt.textContent='0';box.append(cnt);
    binsDiv.append(box);
  }

  // Only add mouse event listeners if not mobile
  if (!isMobile) {
    document.addEventListener('mousemove',e=>{
      if(isLocked){
        // Free-form space movement using quaternions for consistent control
        const sensitivity = 0.002;
        
        // Create rotation quaternions
        const yawQuat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -e.movementX * sensitivity);
        const pitchQuat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -e.movementY * sensitivity);
        
        // Apply rotations to camera quaternion
        camera.quaternion.multiply(yawQuat);
        camera.quaternion.multiply(pitchQuat);
        
        // Update Euler angles for compatibility
        yaw -= e.movementX * sensitivity;
        pitch -= e.movementY * sensitivity;
      }
      const now=performance.now();
      if(isLocked&&lastTime!==null){
        const dt=now-lastTime;
        if(dt>0) recordSample(dt);
      }
      lastTime=now;
    });
  }

  // Only add mouse down listener if not mobile
  if (!isMobile) {
    document.addEventListener('mousedown',e=>{
      if(!isLocked||e.button!==0) return;
      
      // LASER BEAM - shoot from crosshair direction
      const beam = new THREE.Mesh(
        new THREE.CylinderGeometry(0.5, 0.5, 20, 8), // Big, long cylinder
        new THREE.MeshBasicMaterial({color: 0xff0000, transparent: true, opacity: 1}) // BRIGHT RED
      );
      
      // Get the direction the camera is facing
      const direction = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
      
      // Position beam at camera position
      beam.position.copy(camera.position);
      
      // Orient beam in the direction you're looking
      beam.lookAt(camera.position.clone().add(direction.clone().multiplyScalar(100)));
      beam.rotateX(Math.PI/2);
      
      scene.add(beam);
      
      // Store it for animation
      laserBeams.push({
        mesh: beam,
        position: beam.position.clone(),
        velocity: direction.clone().multiplyScalar(3), // Move in the direction you're looking
        life: 100
      });
      
      console.log('RED LASER BEAM CREATED!');
    });
  }

  function animate(){
    requestAnimationFrame(animate);
    
    // Calculate FPS
    fpsCounter++;
    const now = performance.now();
    if (now - fpsTime >= 1000) {
      currentFps = fpsCounter;
      fpsCounter = 0;
      fpsTime = now;
    }
    
    // Move spaceship forward
    const forwardSpeed = 0.5; // Adjust speed here
    const forwardDirection = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
    camera.position.add(forwardDirection.clone().multiplyScalar(forwardSpeed));
    
    // Animate shapes
    shapes.forEach(s=>{
      s.position.add(s.userData.vel);
      ['x','y','z'].forEach(ax=>{if(s.position[ax]>500||s.position[ax]<-500) s.userData.vel[ax]*=-1});
      s.rotation.x+=0.005;
      s.rotation.y+=0.005;
    });
    
    // Animate laser beams with collision detection
    for(let i = laserBeams.length - 1; i >= 0; i--) {
      const beam = laserBeams[i];
      beam.life--;
      
      // Move beam forward
      beam.position.add(beam.velocity);
      beam.mesh.position.copy(beam.position);
      
      // Check for collisions with shapes - improved detection
      const ray = new THREE.Raycaster(beam.position, beam.velocity.clone().normalize());
      const hits = ray.intersectObjects(shapes);
      
      // Check if any shape is close to the beam path
      let hitShape = null;
      let closestDistance = Infinity;
      
      for(let shape of shapes) {
        const distance = beam.position.distanceTo(shape.position);
        if(distance < 15) { // Increased detection range
          hitShape = shape;
          closestDistance = distance;
          break;
        }
      }
      
      if(hitShape) {
        // HIT! Create green explosion
        const hitPoint = hitShape.position.clone();
        
        // Calculate score based on distance
        const distance = camera.position.distanceTo(hitShape.position);
        const distanceScore = Math.floor(distance * 10); // 10 points per unit of distance
        score += distanceScore;
        
        // Remove the hit shape
        scene.remove(hitShape);
        const shapeIndex = shapes.indexOf(hitShape);
        if(shapeIndex > -1) shapes.splice(shapeIndex, 1);
        
        // Create green cloud explosion particles
        for(let j = 0; j < 80; j++) {
          particles.push({
            x3: hitPoint.x,
            y3: hitPoint.y, 
            z3: hitPoint.z,
            vx: (Math.random() - 0.5) * 2, // Slower for cloud effect
            vy: (Math.random() - 0.5) * 2,
            vz: (Math.random() - 0.5) * 2,
            life: 80,
            type: 'cloud', // Green cloud particles
            color: 0x30ff62
          });
        }
        
        // Create red sparks that fly everywhere
        for(let j = 0; j < 30; j++) {
          particles.push({
            x3: hitPoint.x,
            y3: hitPoint.y, 
            z3: hitPoint.z,
            vx: (Math.random() - 0.5) * 8, // Fast sparks
            vy: (Math.random() - 0.5) * 8,
            vz: (Math.random() - 0.5) * 8,
            life: 40,
            type: 'spark', // Red spark particles
            color: 0xff4444
          });
        }
        
        // Remove the beam
        scene.remove(beam.mesh);
        laserBeams.splice(i, 1);
        continue;
      }
      
      // Remove beam if life expired or too far away
      if(beam.life <= 0 || beam.position.distanceTo(camera.position) > 1000) {
        scene.remove(beam.mesh);
        laserBeams.splice(i, 1);
      }
    }
    
    stars.rotation.y+=0.0003;
    renderer.render(scene,camera);
    drawOverlay();
  }
  animate(); resize();

  function drawOverlay(){
    octx.clearRect(0,0,overlay.width,overlay.height);
    
    // Mobile message - show only background and mobile message
    if (isMobile) {
      const cx=overlay.width/2, cy=overlay.height/2;
      const mobileText = "This app is made to test your mouse, not for mobile phones, open it on a physically bigger computer and have a blast";
      
      // Create a semi-transparent overlay for better text readability
      octx.fillStyle = 'rgba(0,0,0,0.8)';
      octx.fillRect(0, 0, overlay.width, overlay.height);
      
      // Draw the mobile message
      octx.font = 'bold 24px Orbitron';
      octx.fillStyle = '#30ff62';
      octx.textAlign = 'center';
      octx.textBaseline = 'middle';
      
      // Word wrap the text to fit the screen
      const maxWidth = overlay.width - 80;
      const words = mobileText.split(' ');
      const lines = [];
      let currentLine = '';
      
      words.forEach(word => {
        const testLine = currentLine + (currentLine ? ' ' : '') + word;
        const testWidth = octx.measureText(testLine).width;
        
        if (testWidth > maxWidth && currentLine) {
          lines.push(currentLine);
          currentLine = word;
        } else {
          currentLine = testLine;
        }
      });
      if (currentLine) lines.push(currentLine);
      
      // Draw each line
      const lineHeight = 35;
      const totalHeight = lines.length * lineHeight;
      const startY = cy - totalHeight / 2;
      
      lines.forEach((line, index) => {
        octx.fillText(line, cx, startY + index * lineHeight);
      });
      
      return; // Exit early for mobile
    }
    
    // reticle
    const cx=overlay.width/2, cy=overlay.height/2;
    octx.strokeStyle='rgba(255,255,255,0.6)';
    octx.lineWidth=2;
    octx.beginPath();octx.arc(cx,cy,20,0,2*Math.PI);octx.stroke();
    octx.beginPath();octx.moveTo(cx-10,cy);octx.lineTo(cx+10,cy);octx.moveTo(cx,cy-10);octx.lineTo(cx,cy+10);octx.stroke();

    octx.save();
    if(!isLocked){
      // main prompt box
      const main='Click to capture mouse';
      octx.font='bold 48px Orbitron';
      const mainWidth = octx.measureText(main).width;
      const wM = mainWidth + 80;
      const hM = 80;
      const xM = cx - wM/2;
      const yM = cy - 180; // Moved up 60px from cy - 120
      octx.fillStyle='rgba(0,0,0,0.7)';
      octx.beginPath();octx.roundRect(xM,yM,wM,hM,15);octx.fill();
      octx.fillStyle='#30ff62';
      octx.textAlign = 'center';
      octx.fillText(main, cx, yM + hM/2 + 16);
      
      // sub prompt box
      const sub="And start the world's most entertaining mouse polling rate test";
      octx.font='26px Orbitron';
      const subWidth = octx.measureText(sub).width;
      const wS = subWidth + 60;
      const hS = 60;
      const xS = cx - wS/2;
      const yS = cy - 100; // Moved up 60px from cy - 40
      octx.fillStyle='rgba(0,0,0,0.7)';
      octx.beginPath();octx.roundRect(xS,yS,wS,hS,12);octx.fill();
      octx.fillStyle='#ffffffbb';
      octx.fillText(sub, cx, yS + hS/2 + 16);
    }
    octx.restore();
    
    // Timer and results display
    if (isLocked && samples.length > 0) {
      const elapsed = (performance.now() - startTime) / 1000;
      const avgHz = samples.reduce((a, b) => a + b, 0) / samples.length;
      
      // Timer display
      octx.font = 'bold 24px Orbitron';
      octx.fillStyle = '#30ff62';
      octx.textAlign = 'left';
      octx.fillText(`Time: ${elapsed.toFixed(1)}s`, 20, 40);
      octx.fillText(`Samples: ${samples.length}`, 20, 70);
      octx.fillText(`Avg: ${avgHz.toFixed(0)}Hz`, 20, 100);
      octx.fillText(`FPS: ${currentFps}`, 20, 130);
      
      // Test mode indicator
      if (testMode) {
        octx.font = 'bold 28px Orbitron';
        octx.fillStyle = '#ff4444';
        octx.textAlign = 'center';
        octx.fillText('TEST MODE', overlay.width / 2, 40);
      }
      
      // Score display in lower right corner
      octx.font = 'bold 32px Orbitron';
      octx.fillStyle = '#30ff62';
      octx.textAlign = 'right';
      octx.fillText(`Score: ${score}`, overlay.width - 20, overlay.height - 20);
      
      // Results box
      if (samples.length > 50) {
        // Find the bin with the highest percentage
        const counts = Array(9).fill(0);
        samples.forEach(h => {
          let i = Math.floor((h - binRanges[0].min) / (binRanges[1].min - binRanges[0].min));
          i = Math.max(0, Math.min(8, i));
          counts[i]++;
        });
        const maxCount = Math.max(...counts);
        const maxPercentage = (maxCount / samples.length) * 100;
        
        let resultText, resultColor;
        if (maxPercentage > 95) {
          resultText = "Perfect poll rate stability";
          resultColor = '#30ff62';
        } else if (maxPercentage > 80) {
          resultText = "Excellent poll rate stability";
          resultColor = '#30ff62';
        } else if (maxPercentage > 60) {
          resultText = "Good poll rate stability";
          resultColor = '#ffff00';
        } else if (maxPercentage > 40) {
          resultText = "Fairly stable poll rate";
          resultColor = '#ff8800';
        } else {
          resultText = "Unstable poll rate";
          resultColor = '#ff4444';
        }
        
        octx.font = 'bold 32px Orbitron';
        const resultWidth = octx.measureText(resultText).width + 40;
        const resultX = overlay.width - resultWidth - 20;
        const resultY = 20;
        
        octx.fillStyle = 'rgba(0,0,0,0.8)';
        octx.beginPath();
        octx.roundRect(resultX, resultY, resultWidth, 50, 10);
        octx.fill();
        
        octx.fillStyle = resultColor;
        octx.textAlign = 'center';
        octx.fillText(resultText, resultX + resultWidth/2, resultY + 32);
      }
    }
    
    // Check if instructions should be hidden (after 5 seconds)
    if (gameStartTime !== null && showInstructions) {
      const elapsed = performance.now() - gameStartTime;
      if (elapsed > 5000) { // 5 seconds
        showInstructions = false;
      }
    }
    
    // Draw explosion particles
    particles.forEach((p, i) => {
      if (p.life <= 0) {
        particles.splice(i, 1);
        return;
      }
      p.life--;
      p.x3 += p.vx;
      p.y3 += p.vy;
      p.z3 += p.vz;
      
      const screenPos = new THREE.Vector3(p.x3, p.y3, p.z3).project(camera);
      const x = (screenPos.x + 1) * overlay.width / 2;
      const y = (-screenPos.y + 1) * overlay.height / 2;
      
      if (x >= 0 && x < overlay.width && y >= 0 && y < overlay.height) {
        let color, size, opacity;
        
        if (p.type === 'cloud') {
          // Green cloud particles - larger, slower fade
          color = '#30ff62';
          size = 4;
          opacity = p.life / 80;
        } else if (p.type === 'spark') {
          // Red spark particles - smaller, bright
          color = '#ff4444';
          size = 2;
          opacity = p.life / 40;
        } else {
          // Default white particles (for old explosions)
          color = '#ffffff';
          size = 3;
          opacity = p.life / 50;
        }
        
        octx.fillStyle = color.replace('#', 'rgba(').replace(')', `, ${opacity})`);
        octx.beginPath();
        octx.arc(x, y, size, 0, 2 * Math.PI);
        octx.fill();
      }
    });
    
    // Draw instruction text at the bottom when game starts
    if (isLocked && showInstructions) {
      const instructionText = "Shoot the objects to earn points, and learn about your polling rate at the same time";
      octx.font = 'bold 24px Orbitron';
      octx.fillStyle = '#30ff62';
      octx.textAlign = 'center';
      octx.textBaseline = 'bottom';
      
      // Add a semi-transparent background for better readability
      const textWidth = octx.measureText(instructionText).width;
      const textX = overlay.width / 2;
      const textY = overlay.height - 40;
      
      octx.fillStyle = 'rgba(0,0,0,0.7)';
      octx.beginPath();
      octx.roundRect(textX - textWidth/2 - 20, textY - 30, textWidth + 40, 40, 10);
      octx.fill();
      
      octx.fillStyle = '#30ff62';
      octx.fillText(instructionText, textX, textY);
    }
  }

  CanvasRenderingContext2D.prototype.roundRect=function(x,y,w,h,r){this.beginPath();this.moveTo(x+r,y);this.lineTo(x+w-r,y);this.quadraticCurveTo(x+w,y,x+w,y+r);this.lineTo(x+w,y+h-r);this.quadraticCurveTo(x+w,y+h,x+w-r,y+h);this.lineTo(x+r,y+h);this.quadraticCurveTo(x,y+h,x,y+h-r);this.lineTo(x,y+r);this.quadraticCurveTo(x,y,x+r,y);this.closePath();};

  function updateBinRanges() {
    if (!samples.length) return;
    const mn = Math.min(...samples);
    const mx = Math.max(...samples);
    const sp = mx - mn;
    const w = Math.max(100, Math.ceil((sp/9)/100)*100);
    binRanges = [];
    for (let i = 0; i < 9; i++) {
      binRanges.push({min: mn + i*w, max: mn + (i+1)*w});
    }
  }
  
  function recordSample(dt) {
    if (dt <= 0) return;
    if (!samples.length) startTime = performance.now();
    let hz = 1000/dt;
    
    // Add randomness in test mode
    if (testMode) {
      // Add random variation to make samples more scattered
      const randomFactor = 0.3; // 30% random variation
      const variation = (Math.random() - 0.5) * 2 * randomFactor;
      hz = hz * (1 + variation);
    }
    
    samples.push(hz);
    updateBinRanges();
    const counts = Array(9).fill(0);
    samples.forEach(h => {
      let i = Math.floor((h - binRanges[0].min) / (binRanges[1].min - binRanges[0].min));
      i = Math.max(0, Math.min(8, i));
      counts[i]++;
    });
    const maxC = Math.max(...counts) || 1;
    binsDiv.childNodes.forEach((box, i) => {
      const c = counts[i];
      const height = 80 + (c/maxC) * (500-80);
      box.style.height = height + 'px';
      box.style.backgroundColor = c > 0 ? '#30ff62' : '#161920';
      const percentage = samples.length > 0 ? Math.round((c / samples.length) * 100) : 0;
      box.querySelector('.count').textContent = percentage + '%';
      box.querySelector('.label').innerHTML = binRanges[i].min < 0 ? '-' : 
        `${Math.round(binRanges[i].min)}Hz<br>to<br>${Math.round(binRanges[i].max)}Hz`;
      
      // Change text color to black when background is green for better readability
      const label = box.querySelector('.label');
      const count = box.querySelector('.count');
      if (c > 0) {
        label.style.color = '#000000';
        count.style.color = '#000000';
      } else {
        label.style.color = '#39FF14';
        count.style.color = '#30ff62';
      }
    });
  }
})(); 