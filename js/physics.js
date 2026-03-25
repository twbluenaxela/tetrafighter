import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';

const BLOCK_SIZE = 0.55;
// No torque controller — hard setRotation for facing (no wobble)

let world = null;
let R = null;
const fighterBodies = new Map();

function quatToYAngle(q) {
    return 2 * Math.atan2(q.y, q.w);
}

function shortestAngleDiff(from, to) {
    let diff = to - from;
    while (diff > Math.PI) diff -= 2 * Math.PI;
    while (diff < -Math.PI) diff += 2 * Math.PI;
    return diff;
}

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
        .setLinearDamping(1.0)
        .setAngularDamping(10.0);

    const body = world.createRigidBody(bd);

    const initAngle = fighter.desiredFacing !== undefined ? fighter.desiredFacing : fighter.group.rotation.y;
    const halfAngle = initAngle / 2;
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
            .setRestitution(0.6)
            .setFriction(0.5);
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

// Force-based movement — preserves collision impulses
export function setFighterVelocity(fighter, vx, vz) {
    const body = fighterBodies.get(fighter);
    if (!body) return;
    const cur = body.linvel();
    const K = 60;
    body.resetForces(true);
    body.addForce({ x: (vx - cur.x) * K, y: 0, z: (vz - cur.z) * K }, true);
}

export function teleportFighter(fighter, x, z, yAngle) {
    const body = fighterBodies.get(fighter);
    if (body) {
        body.setTranslation({ x, y: 0, z }, true);
        body.setLinvel({ x: 0, y: 0, z: 0 }, true);
        body.setAngvel({ x: 0, y: 0, z: 0 }, true);
        body.resetForces(true);
        if (yAngle !== undefined) {
            const ha = yAngle / 2;
            body.setRotation(
                { x: 0, y: Math.sin(ha), z: 0, w: Math.cos(ha) },
                true
            );
            fighter.desiredFacing = yAngle;
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
        .setLinearDamping(1.0)
        .setAngularDamping(10.0);
    const newBody = world.createRigidBody(bd);
    newBody.setRotation(rot, true);

    _addBlockColliders(fighter, newBody, 4.0);
    fighterBodies.set(fighter, newBody);
}

// Torque-based facing + angular momentum transfer from sweep collisions
export function stepAndSync() {
    if (!world) return;

    // Pre-step: sync game state → Rapier
    for (const [fighter, body] of fighterBodies) {
        if (!fighter.alive) continue;

        const bodyGroupY = fighter.bodyGroup ? fighter.bodyGroup.rotation.y : 0;

        if (fighter.rotationAnim) {
            // SWEEPING FIGHTER: animation-controlled rotation
            // Hard setRotation so the sweep arc is precise
            const totalAngle = (fighter.desiredFacing || 0) + bodyGroupY;
            const ha = totalAngle / 2;
            body.setRotation(
                { x: 0, y: Math.sin(ha), z: 0, w: Math.cos(ha) },
                true
            );
            // Angular velocity so Rapier computes contact forces from the sweep
            const angVel = (fighter.rotationAnim.dir * Math.PI / 2)
                           / fighter.rotationAnim.duration * 2.5;
            body.setAngvel({ x: 0, y: angVel, z: 0 }, true);
        } else {
            // NON-SWEEPING: hard snap to desired facing — no torque, no wobble
            const targetAngle = (fighter.desiredFacing || 0) + bodyGroupY;
            const ha = targetAngle / 2;
            body.setRotation(
                { x: 0, y: Math.sin(ha), z: 0, w: Math.cos(ha) },
                true
            );
            body.setAngvel({ x: 0, y: 0, z: 0 }, true);
        }
    }

    world.step();

    // Post-step: Rapier → Three.js (position + rotation readback)
    for (const [fighter, body] of fighterBodies) {
        if (!fighter.alive) continue;

        // Position readback + Y clamp
        const pos = body.translation();
        if (pos.y !== 0) {
            body.setTranslation({ x: pos.x, y: 0, z: pos.z }, true);
        }
        fighter.group.position.x = pos.x;
        fighter.group.position.z = pos.z;
    }
}

export function hasBody(fighter) {
    return fighterBodies.has(fighter);
}
