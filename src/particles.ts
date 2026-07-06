import * as THREE from 'three';

export class SandstormParticles {
  private points: THREE.Points;
  private geometry: THREE.BufferGeometry;
  private particleCount: number;
  private velocities: Float32Array;
  private positions: Float32Array;

  // Faster wind speeds for a true sandstorm effect in local space
  // Blowing strongly towards +X and -Z (diagonal sweep)
  private windSpeedX = 26.0;
  private windSpeedY = -2.0; // sloping down toward the ground
  private windSpeedZ = -16.0;

  // Local bounds size (defining the particle volume box around target)
  private rangeX = 65;
  private rangeY = 20;
  private rangeZ = 65;

  constructor(scene: THREE.Scene, particleCount: number = 4000) {
    this.particleCount = particleCount;
    this.geometry = new THREE.BufferGeometry();
    
    this.positions = new Float32Array(particleCount * 3);
    this.velocities = new Float32Array(particleCount * 3);

    // Initialize sand particles randomly scattered in the LOCAL bounds
    for (let i = 0; i < particleCount; i++) {
      this.positions[i * 3] = (Math.random() - 0.5) * this.rangeX * 2;
      this.positions[i * 3 + 1] = (Math.random() - 0.5) * this.rangeY * 2;
      this.positions[i * 3 + 2] = (Math.random() - 0.5) * this.rangeZ * 2;

      // Give each sand particle distinct high speed with variation
      this.velocities[i * 3] = this.windSpeedX + (Math.random() - 0.5) * 8.0;
      this.velocities[i * 3 + 1] = this.windSpeedY + (Math.random() - 0.5) * 1.0;
      this.velocities[i * 3 + 2] = this.windSpeedZ + (Math.random() - 0.5) * 6.0;
    }

    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));

    // Much smaller size and slightly higher opacity for dust/sand texture
    const material = new THREE.PointsMaterial({
      color: 0xe5c189,       // Sandy/desert color
      size: 0.05,            // Significantly smaller particles for realistic sand dust
      transparent: true,
      opacity: 0.55,         // Higher opacity for visibility since they are tiny
      depthWrite: false,
      sizeAttenuation: true
    });

    this.points = new THREE.Points(this.geometry, material);
    scene.add(this.points);
  }

  /**
   * Updates particle positions locally and snaps the system container to the target position (player/camera).
   */
  public update(targetPos: THREE.Vector3, deltaTime: number) {
    // Smoothly snap the entire particle group's world position to follow the player/camera
    this.points.position.copy(targetPos);

    const positionAttribute = this.geometry.getAttribute('position') as THREE.BufferAttribute;
    const positions = positionAttribute.array as Float32Array;

    // Limit maximum delta time to avoid large jumps during lag spikes
    const dt = Math.min(deltaTime, 0.1);

    for (let i = 0; i < this.particleCount; i++) {
      const idx = i * 3;

      // Update local position based on wind velocity
      positions[idx] += this.velocities[idx] * dt;
      positions[idx + 1] += this.velocities[idx + 1] * dt;
      positions[idx + 2] += this.velocities[idx + 2] * dt;

      // Very subtle air turbulence (high frequency, small amplitude)
      const timeOffset = Date.now() * 0.005 + i;
      positions[idx + 1] += Math.sin(timeOffset) * 0.008;

      const px = positions[idx];
      const py = positions[idx + 1];
      const pz = positions[idx + 2];

      // Since wind blows X+ and Z-, if they go too far right (X+) or far front (Z-),
      // we respawn them on the opposite local boundaries (X- or Z+) with randomized coordinates.
      
      // Wrap X
      if (px > this.rangeX) {
        positions[idx] = -this.rangeX + (Math.random() * 5);
        positions[idx + 1] = (Math.random() - 0.5) * this.rangeY * 2;
        positions[idx + 2] = (Math.random() - 0.5) * this.rangeZ * 2;
      }

      // Wrap Y
      if (py < -this.rangeY) {
        positions[idx] = (Math.random() - 0.5) * this.rangeX * 2;
        positions[idx + 1] = this.rangeY - (Math.random() * 5);
        positions[idx + 2] = (Math.random() - 0.5) * this.rangeZ * 2;
      }

      // Wrap Z
      if (pz < -this.rangeZ) {
        positions[idx] = (Math.random() - 0.5) * this.rangeX * 2;
        positions[idx + 1] = (Math.random() - 0.5) * this.rangeY * 2;
        positions[idx + 2] = this.rangeZ - (Math.random() * 5);
      }
    }

    positionAttribute.needsUpdate = true;
  }

  public destroy(scene: THREE.Scene) {
    scene.remove(this.points);
    this.geometry.dispose();
    if (Array.isArray(this.points.material)) {
      this.points.material.forEach((m) => m.dispose());
    } else {
      this.points.material.dispose();
    }
  }
}

