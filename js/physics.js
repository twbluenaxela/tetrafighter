import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';

const BLOCK_SIZE = 0.55;

let world = null;
let R = null;
const fighterBodies = new Map();

export async function initPhysics() {
    await RAPIER.init();
    R = RAPIER;
}

export function resetWorld() {
    if (world) {
        world.free();
    }
    world = new R.World({ x: 0, y: 0, z: 0 });
    fighterBodies.clear();
}

export function createBoundaries(fieldBounds) {
    const { minX, maxX, minZ, maxZ } = fieldBounds;
    const hw = (maxX - minX) / 2;
    const hl = (maxZ - minZ) / 2;
    const cx = (minX + maxX) / 2;
    const cz = (minZ + maxZ) / 2;
    const t = 1.0;
    const h = 2.0;

    const walls = [
        { x: minX - t, z: cz, hx: t, hz: hl + t },
        { x: maxX + t, z: cz, hx: t, hz: hl + t },
        { x: cx, z: minZ - t, hx: hw + t, hz: t },
        { x: cx, z: maxZ + t, hx: hw + t, hz: t },
    ];

    for (const w of walls) {
        const bd = R.RigidBodyDesc.fixed().setTranslation(w.x, 0, w.z);
        const body = world.createRigidBody(bd);
        const cd = R.ColliderDesc.cuboid(w.hx, h, w.hz);
        world.createCollider(cd, body);
    }
}

function getBlockCenter(blocks) {
    let cx = 0, cz = 0;
    for (const [bx, , bz] of blocks) { cx += bx; cz += bz; }
    return { x: cx / blocks.length, z: cz / blocks.length };
}

export function createFighterBody(fighter, isPlayer = false) {
    const pos = fighter.group.position;
    const bd = R.RigidBodyDesc.dynamic()
        .setTranslation(pos.x, 0, pos.z)
        .setLinearDamping(5.0)
        .setAngularDamping(10.0);

    const body = world.createRigidBody(bd);
    body.setEnabledTranslations(true, false, true, true);
    body.setEnabledRotations(false, false, false, true);

    const halfAngle = fighter.group.rotation.y / 2;
    body.setRotation(
        { x: 0, y: Math.sin(halfAngle), z: 0, w: Math.cos(halfAngle) },
        true
    );

    _addBlockColliders(fighter, body, isPlayer ? 4.0 : 1.0);
    fighterBodies.set(fighter, body);
    return body;
}

function _addBlockColliders(fighter, body, density) {
    const center = getBlockCenter(fighter.blocks);
    const hs = BLOCK_SIZE / 2;

    for (const [bx, , bz] of fighter.blocks) {
        const cd = R.ColliderDesc.cuboid(hs, hs, hs)
            .setTranslation(
                (bx - center.x) * BLOCK_SIZE,
                0,
                (bz - center.z) * BLOCK_SIZE
            )
            .setDensity(density)
            .setRestitution(0.1)
            .setFriction(0.3);
        world.createCollider(cd, body);
    }
}

export function removeFighterBody(fighter) {
    const body = fighterBodies.get(fighter);
    if (body) {
        world.removeRigidBody(body);
        fighterBodies.delete(fighter);
    }
}

export function rebuildColliders(fighter) {
    const body = fighterBodies.get(fighter);
    if (!body) return;

    const density = fighter.isPlayerControlled ? 4.0 : 1.0;

    for (let i = body.numColliders() - 1; i >= 0; i--) {
        world.removeCollider(body.collider(i), false);
    }

    _addBlockColliders(fighter, body, density);
}

export function setFighterVelocity(fighter, vx, vz) {
    const body = fighterBodies.get(fighter);
    if (body) {
        body.setLinvel({ x: vx, y: 0, z: vz }, true);
    }
}

export function teleportFighter(fighter, x, z, yAngle) {
    const body = fighterBodies.get(fighter);
    if (body) {
        body.setTranslation({ x, y: 0, z }, true);
        body.setLinvel({ x: 0, y: 0, z: 0 }, true);
        if (yAngle !== undefined) {
            const ha = yAngle / 2;
            body.setRotation(
                { x: 0, y: Math.sin(ha), z: 0, w: Math.cos(ha) },
                true
            );
        }
    }
}

export function promoteToPlayer(fighter) {
    const body = fighterBodies.get(fighter);
    if (!body) return;

    const pos = body.translation();
    const rot = body.rotation();
    removeFighterBody(fighter);

    const bd = R.RigidBodyDesc.dynamic()
        .setTranslation(pos.x, pos.y, pos.z)
        .setLinearDamping(5.0)
        .setAngularDamping(10.0);
    const newBody = world.createRigidBody(bd);
    newBody.setEnabledTranslations(true, false, true, true);
    newBody.setEnabledRotations(false, false, false, true);
    newBody.setRotation(rot, true);

    _addBlockColliders(fighter, newBody, 4.0);
    fighterBodies.set(fighter, newBody);
}

export function stepAndSync() {
    if (!world) return;

    // Sync facing rotations: game code → Rapier (before step)
    for (const [fighter, body] of fighterBodies) {
        if (!fighter.alive) continue;
        const ha = fighter.group.rotation.y / 2;
        body.setRotation(
            { x: 0, y: Math.sin(ha), z: 0, w: Math.cos(ha) },
            true
        );
    }

    world.step();

    // Sync positions: Rapier → Three.js (after step)
    for (const [fighter, body] of fighterBodies) {
        if (!fighter.alive) continue;
        const pos = body.translation();
        fighter.group.position.x = pos.x;
        fighter.group.position.z = pos.z;
    }
}

/**
 * Called each frame while a fighter is mid-rotation-animation.
 * Computes block world positions using the current visual sweep angle and
 * directly nudges nearby fighter bodies outward.
 */
export function applyRotationSweepForce(fighter) {
    const body = fighterBodies.get(fighter);
    if (!body) return;

    const PUSH_RANGE = 1.3;
    const PUSH_STRENGTH = 0.05;

    const rotPos = body.translation();
    // Use visual sweep angle (group facing + bodyGroup sweep)
    const totalAngle = fighter.group.rotation.y + (fighter.bodyGroup ? fighter.bodyGroup.rotation.y : 0);
    const cos = Math.cos(totalAngle);
    const sin = Math.sin(totalAngle);
    const center = getBlockCenter(fighter.blocks);

    for (const [otherFighter, otherBody] of fighterBodies) {
        if (otherFighter === fighter || !otherFighter.alive) continue;

        const otherPos = otherBody.translation();
        let closestDist = Infinity;
        let pushX = 0, pushZ = 0;

        for (const [bx, , bz] of fighter.blocks) {
            const lx = (bx - center.x) * BLOCK_SIZE;
            const lz = (bz - center.z) * BLOCK_SIZE;
            const wx = rotPos.x + lx * cos + lz * sin;
            const wz = rotPos.z + (-lx * sin + lz * cos);

            const dx = otherPos.x - wx;
            const dz = otherPos.z - wz;
            const dist = Math.sqrt(dx * dx + dz * dz);
            if (dist < closestDist) {
                closestDist = dist;
                pushX = dx;
                pushZ = dz;
            }
        }

        if (closestDist < PUSH_RANGE && closestDist > 0.01) {
            const len = Math.sqrt(pushX * pushX + pushZ * pushZ);
            const strength = PUSH_STRENGTH * (1 - closestDist / PUSH_RANGE) / len;
            const newX = otherPos.x + pushX * strength;
            const newZ = otherPos.z + pushZ * strength;
            otherBody.setTranslation({ x: newX, y: 0, z: newZ }, true);
            otherFighter.group.position.x = newX;
            otherFighter.group.position.z = newZ;
        }
    }
}

export function hasBody(fighter) {
    return fighterBodies.has(fighter);
}
