import * as THREE from 'three';

// Tetromino shape definitions (relative block positions)
export const SHAPES = {
    I: { blocks: [[0,0,0],[1,0,0],[2,0,0],[3,0,0]], color: 0x00bcd4, name: 'I' },
    O: { blocks: [[0,0,0],[1,0,0],[0,0,1],[1,0,1]], color: 0xffeb3b, name: 'O' },
    T: { blocks: [[0,0,0],[1,0,0],[2,0,0],[1,0,1]], color: 0x9c27b0, name: 'T' },
    S: { blocks: [[1,0,0],[2,0,0],[0,0,1],[1,0,1]], color: 0x4caf50, name: 'S' },
    Z: { blocks: [[0,0,0],[1,0,0],[1,0,1],[2,0,1]], color: 0xf44336, name: 'Z' },
    L: { blocks: [[0,0,0],[0,0,1],[0,0,2],[1,0,2]], color: 0xff9800, name: 'L' },
    J: { blocks: [[1,0,0],[1,0,1],[1,0,2],[0,0,2]], color: 0x2196f3, name: 'J' },
};

const SHAPE_KEYS = Object.keys(SHAPES);
const BLOCK_SIZE = 1.0;
const BLOCK_GAP = 0.05;

export function randomShapeKey() {
    return SHAPE_KEYS[Math.floor(Math.random() * SHAPE_KEYS.length)];
}

// Create a single cube mesh
function createBlockMesh(color, teamColor) {
    const size = BLOCK_SIZE - BLOCK_GAP;
    const geometry = new THREE.BoxGeometry(size, size, size);
    const material = new THREE.MeshPhongMaterial({
        color: teamColor,
        emissive: new THREE.Color(teamColor).multiplyScalar(0.15),
        specular: 0x444444,
        shininess: 30,
        transparent: true,
        opacity: 0.92,
    });
    const mesh = new THREE.Mesh(geometry, material);

    // Add wireframe edge
    const edges = new THREE.EdgesGeometry(geometry);
    const line = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({
        color: new THREE.Color(teamColor).multiplyScalar(1.5),
        transparent: true,
        opacity: 0.6,
    }));
    mesh.add(line);

    return mesh;
}

export class Tetromino {
    constructor(shapeKey, team, position, scene) {
        this.shapeKey = shapeKey;
        this.shapeDef = SHAPES[shapeKey];
        this.team = team; // 'blue' or 'red'
        this.scene = scene;
        this.alive = true;
        this.inBattle = false;
        this.battleTarget = null;
        this.speed = 3.0;
        this.mass = this.shapeDef.blocks.length;
        this.repelCooldown = 0;
        this.attractPower = 0;
        this.repelPower = 0;

        // Block data — can grow when absorbing
        this.blocks = this.shapeDef.blocks.map(b => [...b]);

        // Team colors
        this.teamColor = team === 'blue' ? 0x4fc3f7 : 0xef5350;
        this.teamColorDark = team === 'blue' ? 0x1565c0 : 0xc62828;

        // Create group
        this.group = new THREE.Group();
        this.group.position.copy(position);
        this.group.userData.tetromino = this;

        // Build meshes
        this.blockMeshes = [];
        this._buildMeshes();

        // Movement direction: blue goes +z, red goes -z
        this.direction = team === 'blue' ? 1 : -1;

        // Velocity for physics-based movement during battles
        this.velocity = new THREE.Vector3();

        // Target for AI-controlled pieces
        this.targetEnemy = null;

        scene.add(this.group);
    }

    _buildMeshes() {
        // Clear old meshes
        this.blockMeshes.forEach(m => this.group.remove(m));
        this.blockMeshes = [];

        // Center the blocks
        const center = this._getCenter();

        this.blocks.forEach(([bx, by, bz]) => {
            const mesh = createBlockMesh(this.shapeDef.color, this.teamColor);
            mesh.position.set(
                (bx - center.x) * BLOCK_SIZE,
                by * BLOCK_SIZE + BLOCK_SIZE * 0.5,
                (bz - center.z) * BLOCK_SIZE
            );
            this.group.add(mesh);
            this.blockMeshes.push(mesh);
        });
    }

    _getCenter() {
        let cx = 0, cz = 0;
        this.blocks.forEach(([bx, , bz]) => { cx += bx; cz += bz; });
        return { x: cx / this.blocks.length, z: cz / this.blocks.length };
    }

    get position() {
        return this.group.position;
    }

    getBoundingRadius() {
        let maxDist = 0;
        this.blocks.forEach(([bx, , bz]) => {
            const center = this._getCenter();
            const dx = bx - center.x;
            const dz = bz - center.z;
            maxDist = Math.max(maxDist, Math.sqrt(dx * dx + dz * dz));
        });
        return (maxDist + 0.5) * BLOCK_SIZE;
    }

    update(dt, fieldBounds) {
        if (!this.alive) return;

        this.repelCooldown = Math.max(0, this.repelCooldown - dt);

        if (!this.inBattle) {
            // Normal movement: advance toward enemy side
            this.group.position.z += this.direction * this.speed * dt;

            // Slight lateral movement toward target
            if (this.targetEnemy && this.targetEnemy.alive) {
                const dx = this.targetEnemy.position.x - this.group.position.x;
                this.group.position.x += Math.sign(dx) * Math.min(Math.abs(dx), this.speed * 0.5 * dt);
            }

            // Clamp to field
            this.group.position.x = THREE.MathUtils.clamp(
                this.group.position.x, fieldBounds.minX + 1, fieldBounds.maxX - 1
            );
            this.group.position.z = THREE.MathUtils.clamp(
                this.group.position.z, fieldBounds.minZ, fieldBounds.maxZ
            );
        } else {
            // Apply velocity (from repel/attract forces)
            this.group.position.add(this.velocity.clone().multiplyScalar(dt));
            this.velocity.multiplyScalar(0.92); // Damping

            // Clamp to field
            this.group.position.x = THREE.MathUtils.clamp(
                this.group.position.x, fieldBounds.minX + 1, fieldBounds.maxX - 1
            );
            this.group.position.z = THREE.MathUtils.clamp(
                this.group.position.z, fieldBounds.minZ, fieldBounds.maxZ
            );
        }

        // Bob animation
        const bobAmount = Math.sin(Date.now() * 0.003 + this.group.id) * 0.08;
        this.blockMeshes.forEach(m => {
            m.position.y = m.position.y > 0 ?
                Math.max(BLOCK_SIZE * 0.5, m.position.y + bobAmount * 0.01) :
                m.position.y;
        });
    }

    absorb(other) {
        // Merge other's blocks into this piece
        const otherCenter = other._getCenter();
        const myCenter = this._getCenter();

        // Offset: place other's blocks relative to ours, adjacent in z
        const maxZ = Math.max(...this.blocks.map(b => b[2]));
        const minZOther = Math.min(...other.blocks.map(b => b[2]));
        const offsetZ = maxZ - minZOther + 1;

        const offsetX = Math.round(other.position.x - this.position.x);

        other.blocks.forEach(([bx, by, bz]) => {
            this.blocks.push([bx + offsetX, by, bz + offsetZ]);
        });

        this.mass = this.blocks.length;
        this._buildMeshes();

        // Grow speed slightly with size (diminishing returns)
        this.speed = Math.max(1.5, 3.0 - this.blocks.length * 0.08);

        // Remove the absorbed piece
        other.destroy();
    }

    applyRepel(targetPos) {
        const dir = new THREE.Vector3().subVectors(this.position, targetPos).normalize();
        this.velocity.add(dir.multiplyScalar(12));
    }

    applyAttract(targetPos) {
        const dir = new THREE.Vector3().subVectors(targetPos, this.position).normalize();
        this.velocity.add(dir.multiplyScalar(8));
    }

    setHighlight(on) {
        this.blockMeshes.forEach(mesh => {
            mesh.material.emissive.set(on ? 0xffffff : new THREE.Color(this.teamColor).multiplyScalar(0.15));
            mesh.material.emissiveIntensity = on ? 0.3 : 1.0;
        });
    }

    rotateShape() {
        // Rotate blocks 90 degrees around Y axis
        const center = this._getCenter();
        this.blocks = this.blocks.map(([bx, by, bz]) => {
            const rx = bx - center.x;
            const rz = bz - center.z;
            return [Math.round(-rz + center.x), by, Math.round(rx + center.z)];
        });
        this._buildMeshes();
    }

    destroy() {
        this.alive = false;
        this.inBattle = false;
        this.battleTarget = null;

        // Particle-like destruction effect
        this.blockMeshes.forEach(mesh => {
            mesh.material.transparent = true;
            const startTime = Date.now();
            const origY = mesh.position.y;
            const randDir = new THREE.Vector3(
                (Math.random() - 0.5) * 6,
                Math.random() * 8 + 2,
                (Math.random() - 0.5) * 6
            );

            const animate = () => {
                const t = (Date.now() - startTime) / 600;
                if (t > 1) {
                    this.group.remove(mesh);
                    mesh.geometry.dispose();
                    mesh.material.dispose();
                    return;
                }
                mesh.position.add(randDir.clone().multiplyScalar(0.016));
                randDir.y -= 0.3;
                mesh.material.opacity = 1 - t;
                mesh.scale.setScalar(1 - t * 0.5);
                requestAnimationFrame(animate);
            };
            animate();
        });

        setTimeout(() => {
            this.scene.remove(this.group);
        }, 800);
    }

    getWorldBoundingBox() {
        const box = new THREE.Box3();
        const center = this._getCenter();
        this.blocks.forEach(([bx, , bz]) => {
            const wx = this.group.position.x + (bx - center.x) * BLOCK_SIZE;
            const wz = this.group.position.z + (bz - center.z) * BLOCK_SIZE;
            box.expandByPoint(new THREE.Vector3(wx - 0.5, 0, wz - 0.5));
            box.expandByPoint(new THREE.Vector3(wx + 0.5, 1, wz + 0.5));
        });
        return box;
    }
}
