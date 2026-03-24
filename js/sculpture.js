import * as THREE from 'three';
import { SHAPES } from './tetromino.js';

/**
 * SculptureBuilder — manages the art pieces on each side of the arena.
 * When a fighter wins a battle, the loser's shape gets added to the
 * winner's team sculpture on the sideline, building a randomized art piece.
 */

const BLOCK_SIZE = 0.5;
const SCULPTURE_OFFSET_X = 15; // How far off to the side

export class SculptureBuilder {
    constructor(scene, fieldBounds) {
        this.scene = scene;
        this.fieldBounds = fieldBounds;

        // Each team has a sculpture area
        this.blueSculpture = new THREE.Group();
        this.blueSculpture.position.set(-SCULPTURE_OFFSET_X, 0, -5);
        scene.add(this.blueSculpture);

        this.redSculpture = new THREE.Group();
        this.redSculpture.position.set(SCULPTURE_OFFSET_X, 0, 5);
        scene.add(this.redSculpture);

        // Track placed blocks for stacking
        this.bluePlacements = [];
        this.redPlacements = [];

        this.blueNextZ = 0;
        this.redNextZ = 0;
        this.blueNextY = 0;
        this.redNextY = 0;
        this.blueRowWidth = 0;
        this.redRowWidth = 0;

        // Build pedestals
        this._buildPedestal(this.blueSculpture, 0x4fc3f7);
        this._buildPedestal(this.redSculpture, 0xef5350);

        // Spotlights on sculptures
        const blueSpot = new THREE.SpotLight(0x4fc3f7, 1.5, 25, Math.PI / 5, 0.5);
        blueSpot.position.set(-SCULPTURE_OFFSET_X, 12, -5);
        blueSpot.target = this.blueSculpture;
        scene.add(blueSpot);
        scene.add(blueSpot.target);

        const redSpot = new THREE.SpotLight(0xef5350, 1.5, 25, Math.PI / 5, 0.5);
        redSpot.position.set(SCULPTURE_OFFSET_X, 12, 5);
        redSpot.target = this.redSculpture;
        scene.add(redSpot);
        scene.add(redSpot.target);
    }

    _buildPedestal(group, color) {
        const pedestalGeo = new THREE.BoxGeometry(5, 0.3, 5);
        const pedestalMat = new THREE.MeshPhongMaterial({
            color: 0x222233,
            specular: color,
            shininess: 40,
        });
        const pedestal = new THREE.Mesh(pedestalGeo, pedestalMat);
        pedestal.position.y = 0.15;
        group.add(pedestal);

        // Label
        // We skip text (no font loader) — use a glowing plane instead
        const labelGeo = new THREE.PlaneGeometry(4, 0.4);
        const labelMat = new THREE.MeshBasicMaterial({
            color: color,
            transparent: true,
            opacity: 0.15,
            side: THREE.DoubleSide,
        });
        const label = new THREE.Mesh(labelGeo, labelMat);
        label.position.set(0, 0.32, 2.8);
        label.rotation.x = -Math.PI / 6;
        group.add(label);
    }

    /**
     * Add a captured shape to a team's sculpture.
     * The shape gets placed on the sculpture in a semi-random, stacking fashion.
     */
    addShape(team, shapeData) {
        const sculpture = team === 'blue' ? this.blueSculpture : this.redSculpture;
        const placements = team === 'blue' ? this.bluePlacements : this.redPlacements;

        const shapeGroup = new THREE.Group();

        // Random rotation for artistic variety
        const rotations = [0, Math.PI / 2, Math.PI, Math.PI * 1.5];
        const rotation = rotations[Math.floor(Math.random() * rotations.length)];

        // Calculate placement position
        const yLevel = this._getNextY(team);
        const xOffset = (Math.random() - 0.5) * 1.5;
        const zOffset = (Math.random() - 0.5) * 1.5;

        // Build the shape blocks
        const blocks = shapeData.blocks;
        const center = { x: 0, z: 0 };
        blocks.forEach(([bx, , bz]) => { center.x += bx; center.z += bz; });
        center.x /= blocks.length;
        center.z /= blocks.length;

        blocks.forEach(([bx, , bz]) => {
            const size = BLOCK_SIZE - 0.03;
            const geo = new THREE.BoxGeometry(size, size, size);

            // Use the original shape color, mixed with team tint
            const baseColor = new THREE.Color(shapeData.color);
            const teamTint = new THREE.Color(team === 'blue' ? 0x4fc3f7 : 0xef5350);
            const finalColor = baseColor.clone().lerp(teamTint, 0.3);

            const mat = new THREE.MeshPhongMaterial({
                color: finalColor,
                emissive: finalColor.clone().multiplyScalar(0.1),
                specular: 0x444444,
                shininess: 50,
                transparent: true,
                opacity: 0.9,
            });
            const mesh = new THREE.Mesh(geo, mat);

            // Apply rotation to block position
            let rx = bx - center.x;
            let rz = bz - center.z;
            const cos = Math.cos(rotation);
            const sin = Math.sin(rotation);
            const newX = rx * cos - rz * sin;
            const newZ = rx * sin + rz * cos;

            mesh.position.set(
                newX * BLOCK_SIZE,
                0,
                newZ * BLOCK_SIZE
            );

            // Wireframe edge
            const edges = new THREE.EdgesGeometry(geo);
            const line = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({
                color: 0xffffff,
                transparent: true,
                opacity: 0.2,
            }));
            mesh.add(line);

            shapeGroup.add(mesh);
        });

        shapeGroup.position.set(xOffset, 0.3 + yLevel, zOffset);
        shapeGroup.rotation.y = Math.random() * Math.PI * 0.3 - 0.15;

        // Animate it flying in
        const targetY = shapeGroup.position.y;
        shapeGroup.position.y = targetY + 8;
        shapeGroup.scale.setScalar(0.01);

        const startTime = Date.now();
        const animateIn = () => {
            const t = Math.min(1, (Date.now() - startTime) / 600);
            const ease = 1 - Math.pow(1 - t, 3); // ease-out cubic
            shapeGroup.position.y = targetY + 8 * (1 - ease);
            shapeGroup.scale.setScalar(ease);
            shapeGroup.rotation.y += (1 - t) * 0.1;
            if (t < 1) requestAnimationFrame(animateIn);
        };
        animateIn();

        sculpture.add(shapeGroup);
        placements.push({
            shapeKey: shapeData.shapeKey,
            group: shapeGroup,
            y: yLevel,
        });

        return shapeGroup;
    }

    _getNextY(team) {
        const placements = team === 'blue' ? this.bluePlacements : this.redPlacements;
        if (placements.length === 0) return 0;

        // Stack upward, with some randomness
        const maxY = Math.max(...placements.map(p => p.y));
        // Every few pieces, stack higher
        const stackEvery = 3;
        if (placements.length % stackEvery === 0) {
            return maxY + BLOCK_SIZE * 2;
        }
        return maxY + BLOCK_SIZE * (0.3 + Math.random() * 0.5);
    }

    /**
     * Get the sculpture group for the end-game showcase camera.
     */
    getSculpture(team) {
        return team === 'blue' ? this.blueSculpture : this.redSculpture;
    }

    getShapeCount(team) {
        return team === 'blue' ? this.bluePlacements.length : this.redPlacements.length;
    }
}
