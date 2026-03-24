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
const BLOCK_SIZE = 0.55;

export function randomShapeKey() {
    return SHAPE_KEYS[Math.floor(Math.random() * SHAPE_KEYS.length)];
}

// Create a rounded cube-ish block
function createBlockMesh(teamColor) {
    const size = BLOCK_SIZE - 0.04;
    const geometry = new THREE.BoxGeometry(size, size, size);
    const material = new THREE.MeshPhongMaterial({
        color: teamColor,
        emissive: new THREE.Color(teamColor).multiplyScalar(0.12),
        specular: 0x444444,
        shininess: 40,
    });
    const mesh = new THREE.Mesh(geometry, material);
    const edges = new THREE.EdgesGeometry(geometry);
    const line = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({
        color: new THREE.Color(teamColor).multiplyScalar(1.4),
        transparent: true,
        opacity: 0.5,
    }));
    mesh.add(line);
    return mesh;
}

// Build the tetromino "body" (head) — the block shape sits on top
function buildBody(blocks, teamColor) {
    const bodyGroup = new THREE.Group();
    const center = getBlockCenter(blocks);
    blocks.forEach(([bx, , bz]) => {
        const mesh = createBlockMesh(teamColor);
        mesh.position.set(
            (bx - center.x) * BLOCK_SIZE,
            0,
            (bz - center.z) * BLOCK_SIZE
        );
        bodyGroup.add(mesh);
    });
    return bodyGroup;
}

function getBlockCenter(blocks) {
    let cx = 0, cz = 0;
    blocks.forEach(([bx, , bz]) => { cx += bx; cz += bz; });
    return { x: cx / blocks.length, z: cz / blocks.length };
}

// Build a simple limb (arm or leg) from capsule-like shapes
function createLimb(length, thickness, color) {
    const geo = new THREE.CylinderGeometry(thickness, thickness * 0.8, length, 6);
    const mat = new THREE.MeshPhongMaterial({
        color: color,
        emissive: new THREE.Color(color).multiplyScalar(0.08),
        specular: 0x333333,
        shininess: 20,
    });
    const limb = new THREE.Mesh(geo, mat);
    // Pivot at the top of the limb
    limb.geometry.translate(0, -length / 2, 0);
    return limb;
}

// Create a "foot" or "hand" — small sphere
function createExtremity(radius, color) {
    const geo = new THREE.SphereGeometry(radius, 6, 6);
    const mat = new THREE.MeshPhongMaterial({ color, specular: 0x333333, shininess: 20 });
    return new THREE.Mesh(geo, mat);
}

// Simple googly eyes
function createEyes(teamColor) {
    const eyeGroup = new THREE.Group();
    const eyeWhite = new THREE.MeshPhongMaterial({ color: 0xffffff });
    const eyePupil = new THREE.MeshPhongMaterial({ color: 0x111111 });

    [-0.15, 0.15].forEach(xOff => {
        const white = new THREE.Mesh(new THREE.SphereGeometry(0.1, 8, 8), eyeWhite);
        white.position.set(xOff, 0, 0.25);
        const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.055, 6, 6), eyePupil);
        pupil.position.set(xOff, 0, 0.32);
        eyeGroup.add(white, pupil);
    });
    return eyeGroup;
}

export class TetraFighter {
    constructor(shapeKey, team, position, scene) {
        this.shapeKey = shapeKey;
        this.shapeDef = SHAPES[shapeKey];
        this.team = team;
        this.scene = scene;
        this.alive = true;
        this.speed = 3.5;
        this.mass = this.shapeDef.blocks.length;
        this.blocks = this.shapeDef.blocks.map(b => [...b]);

        this.teamColor = team === 'blue' ? 0x4fc3f7 : 0xef5350;
        this.teamColorDark = team === 'blue' ? 0x1565c0 : 0xc62828;
        this.limbColor = team === 'blue' ? 0x2288cc : 0xcc3333;

        // Root group
        this.group = new THREE.Group();
        this.group.position.copy(position);
        this.group.userData.fighter = this;

        // Direction: blue goes +z, red goes -z
        this.direction = team === 'blue' ? 1 : -1;
        // Face the direction of movement
        if (this.direction === -1) {
            this.group.rotation.y = Math.PI;
        }

        this.velocity = new THREE.Vector3();
        this.targetEnemy = null;
        this.isPlayerControlled = false;

        // Animation state
        this.runPhase = Math.random() * Math.PI * 2;
        this.isRunning = false; // driven by actual movement
        this.bodyRotation = 0; // cumulative body rotation in 90° increments

        // Build the character
        this._buildCharacter();

        scene.add(this.group);
    }

    _buildCharacter() {
        // The tetromino shape sits as the "torso/head" on top
        const bodyHeight = 1.6;
        this.bodyGroup = buildBody(this.blocks, this.teamColor);
        this.bodyGroup.position.y = bodyHeight;
        this.group.add(this.bodyGroup);

        // Eyes on the front of the body
        this.eyes = createEyes(this.teamColor);
        this.eyes.position.y = bodyHeight + 0.05;
        this.group.add(this.eyes);

        // --- ARMS ---
        const armLength = 0.6;
        const armThickness = 0.07;
        const bodyWidth = this._getBodyWidth();

        // Left arm pivot
        this.leftArmPivot = new THREE.Group();
        this.leftArmPivot.position.set(-bodyWidth / 2 - 0.1, bodyHeight - 0.05, 0);
        this.leftArm = createLimb(armLength, armThickness, this.limbColor);
        this.leftArmPivot.add(this.leftArm);
        const leftHand = createExtremity(0.08, this.teamColor);
        leftHand.position.y = -armLength;
        this.leftArm.add(leftHand);
        this.group.add(this.leftArmPivot);

        // Right arm pivot
        this.rightArmPivot = new THREE.Group();
        this.rightArmPivot.position.set(bodyWidth / 2 + 0.1, bodyHeight - 0.05, 0);
        this.rightArm = createLimb(armLength, armThickness, this.limbColor);
        this.rightArmPivot.add(this.rightArm);
        const rightHand = createExtremity(0.08, this.teamColor);
        rightHand.position.y = -armLength;
        this.rightArm.add(rightHand);
        this.group.add(this.rightArmPivot);

        // --- LEGS ---
        const legLength = 0.7;
        const legThickness = 0.09;

        // Left leg pivot
        this.leftLegPivot = new THREE.Group();
        this.leftLegPivot.position.set(-0.15, 0.9, 0);
        this.leftLeg = createLimb(legLength, legThickness, this.limbColor);
        this.leftLegPivot.add(this.leftLeg);
        const leftFoot = createExtremity(0.1, this.teamColorDark);
        leftFoot.position.y = -legLength;
        this.leftLeg.add(leftFoot);
        this.group.add(this.leftLegPivot);

        // Right leg pivot
        this.rightLegPivot = new THREE.Group();
        this.rightLegPivot.position.set(0.15, 0.9, 0);
        this.rightLeg = createLimb(legLength, legThickness, this.limbColor);
        this.rightLegPivot.add(this.rightLeg);
        const rightFoot = createExtremity(0.1, this.teamColorDark);
        rightFoot.position.y = -legLength;
        this.rightLeg.add(rightFoot);
        this.group.add(this.rightLegPivot);

        // Shadow blob on ground
        const shadowGeo = new THREE.CircleGeometry(0.5, 12);
        const shadowMat = new THREE.MeshBasicMaterial({
            color: 0x000000, transparent: true, opacity: 0.25,
        });
        this.shadow = new THREE.Mesh(shadowGeo, shadowMat);
        this.shadow.rotation.x = -Math.PI / 2;
        this.shadow.position.y = 0.02;
        this.group.add(this.shadow);
    }

    _getBodyWidth() {
        const xs = this.blocks.map(b => b[0]);
        return (Math.max(...xs) - Math.min(...xs) + 1) * BLOCK_SIZE;
    }

    get position() {
        return this.group.position;
    }

    update(dt, fieldBounds) {
        if (!this.alive) return;

        // Animation
        if (this.isRunning) {
            const animSpeed = this.isSprinting ? 12 : 7;
            this.runPhase += dt * animSpeed;
            const swing = Math.sin(this.runPhase);
            const swingAmp = this.isSprinting ? 0.7 : 0.4;
            const armSwing = swing * (this.isSprinting ? 0.8 : 0.4);

            this.leftLegPivot.rotation.x = swing * swingAmp;
            this.rightLegPivot.rotation.x = -swing * swingAmp;
            this.leftArmPivot.rotation.x = -armSwing;
            this.rightArmPivot.rotation.x = armSwing;

            // Body bob
            this.bodyGroup.position.y = 1.6 + Math.abs(Math.sin(this.runPhase * 2)) * 0.08;
            this.eyes.position.y = this.bodyGroup.position.y + 0.05;
        } else {
            // Idle — gently return limbs to rest
            this.leftLegPivot.rotation.x *= 0.9;
            this.rightLegPivot.rotation.x *= 0.9;
            this.leftArmPivot.rotation.x *= 0.9;
            this.rightArmPivot.rotation.x *= 0.9;
            this.bodyGroup.position.y = 1.6;
            this.eyes.position.y = 1.65;
        }

        // Player-controlled pieces — WASD handled by main.js, just clamp bounds
        if (this.isPlayerControlled) {
            this.group.position.x = THREE.MathUtils.clamp(
                this.group.position.x, fieldBounds.minX + 1, fieldBounds.maxX - 1
            );
            this.group.position.z = THREE.MathUtils.clamp(
                this.group.position.z, fieldBounds.minZ, fieldBounds.maxZ
            );
            return;
        }

        // AI movement — seek target enemy, not just march forward
        this.isRunning = true;
        this.isSprinting = true;

        if (this.targetEnemy && this.targetEnemy.alive) {
            // Move toward the target enemy
            const toEnemy = new THREE.Vector3(
                this.targetEnemy.position.x - this.position.x,
                0,
                this.targetEnemy.position.z - this.position.z
            );
            const dist = toEnemy.length();

            if (dist > 0.5) {
                toEnemy.normalize();
                this.group.position.x += toEnemy.x * this.speed * dt;
                this.group.position.z += toEnemy.z * this.speed * dt;
                this.velocity.copy(toEnemy).multiplyScalar(this.speed);

                // Face movement direction
                this.group.rotation.y = Math.atan2(toEnemy.x, toEnemy.z);
            } else {
                this.velocity.set(0, 0, 0);
            }
        } else {
            // No target — march forward as fallback
            this.group.position.z += this.direction * this.speed * dt;
            this.velocity.set(0, 0, this.direction * this.speed);

            const baseAngle = this.direction === -1 ? Math.PI : 0;
            this.group.rotation.y = baseAngle;
        }

        this.group.position.x = THREE.MathUtils.clamp(
            this.group.position.x, fieldBounds.minX + 1, fieldBounds.maxX - 1
        );
        this.group.position.z = THREE.MathUtils.clamp(
            this.group.position.z, fieldBounds.minZ, fieldBounds.maxZ
        );
    }

    /**
     * Rotate the tetromino body 90° around Y axis.
     * dir: 1 = clockwise (E key), -1 = counter-clockwise (Q key)
     */
    rotateBody(dir) {
        const center = getBlockCenter(this.blocks);
        this.blocks = this.blocks.map(([bx, by, bz]) => {
            const rx = bx - center.x;
            const rz = bz - center.z;
            if (dir === 1) {
                // CW: (x,z) -> (z, -x)
                return [Math.round(rz + center.x), by, Math.round(-rx + center.z)];
            } else {
                // CCW: (x,z) -> (-z, x)
                return [Math.round(-rz + center.x), by, Math.round(rx + center.z)];
            }
        });
        this.bodyRotation += dir * Math.PI / 2;

        // Rebuild body meshes
        this._rebuildBody();
    }

    _rebuildBody() {
        // Remove old body meshes
        while (this.bodyGroup.children.length > 0) {
            const child = this.bodyGroup.children[0];
            this.bodyGroup.remove(child);
        }
        // Rebuild
        const center = getBlockCenter(this.blocks);
        this.blocks.forEach(([bx, , bz]) => {
            const mesh = createBlockMesh(this.teamColor);
            mesh.position.set(
                (bx - center.x) * BLOCK_SIZE,
                0,
                (bz - center.z) * BLOCK_SIZE
            );
            this.bodyGroup.add(mesh);
        });
    }

    /**
     * Get the world-space block positions for connection checking.
     * Returns blocks projected onto the XZ plane relative to the fighter's world position,
     * accounting for the fighter's Y-axis rotation.
     */
    getWorldBlocks() {
        const center = getBlockCenter(this.blocks);
        const angle = this.group.rotation.y;
        const cos = Math.cos(angle);
        const sin = Math.sin(angle);

        return this.blocks.map(([bx, by, bz]) => {
            const lx = (bx - center.x) * BLOCK_SIZE;
            const lz = (bz - center.z) * BLOCK_SIZE;
            // Rotate by group rotation
            const wx = lx * cos + lz * sin;
            const wz = -lx * sin + lz * cos;
            // Snap to grid (half-block resolution)
            return [
                Math.round((this.position.x + wx) * 2) / 2,
                Math.round((this.position.z + wz) * 2) / 2,
            ];
        });
    }

    setHighlight(on) {
        this.bodyGroup.children.forEach(mesh => {
            if (mesh.material) {
                mesh.material.emissive.set(
                    on ? 0xffffff : new THREE.Color(this.teamColor).multiplyScalar(0.12)
                );
                mesh.material.emissiveIntensity = on ? 0.25 : 1.0;
            }
        });
    }

    getShapeData() {
        return {
            shapeKey: this.shapeKey,
            blocks: this.blocks.map(b => [...b]),
            color: this.shapeDef.color,
        };
    }

    destroy() {
        this.alive = false;

        // Death animation: character falls apart
        const parts = [
            this.bodyGroup, this.leftArmPivot, this.rightArmPivot,
            this.leftLegPivot, this.rightLegPivot,
        ];

        parts.forEach((part, i) => {
            const startTime = Date.now();
            const randDir = new THREE.Vector3(
                (Math.random() - 0.5) * 4,
                Math.random() * 6 + 2,
                (Math.random() - 0.5) * 4
            );
            const randRot = new THREE.Vector3(
                (Math.random() - 0.5) * 8,
                (Math.random() - 0.5) * 8,
                (Math.random() - 0.5) * 8,
            );

            const animate = () => {
                const t = (Date.now() - startTime) / 700;
                if (t > 1) {
                    return;
                }
                part.position.add(randDir.clone().multiplyScalar(0.016));
                randDir.y -= 0.25;
                part.rotation.x += randRot.x * 0.016;
                part.rotation.z += randRot.z * 0.016;
                // Fade out all meshes in part
                part.traverse(child => {
                    if (child.material) {
                        child.material.transparent = true;
                        child.material.opacity = 1 - t;
                    }
                });
                requestAnimationFrame(animate);
            };
            animate();
        });

        setTimeout(() => {
            this.scene.remove(this.group);
        }, 900);
    }
}
