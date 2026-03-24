/**
 * Tetris-style connection detection.
 * Checks if two sets of world-space blocks fit together like Tetris pieces.
 */

const CONNECTION_GRID = 0.5;

/**
 * Check if two sets of grid-snapped blocks form a valid Tetris connection.
 * A connection requires:
 *   1. At least one pair of blocks is edge-adjacent (Manhattan distance = 1 grid cell)
 *   2. No blocks overlap
 * Returns { connected, adjacentCount, overlaps }
 */
export function checkConnection(blocksA, blocksB) {
    const g = CONNECTION_GRID;
    const bSet = new Set();
    blocksB.forEach(([x, z]) => {
        bSet.add(`${Math.round(x / g)},${Math.round(z / g)}`);
    });

    let adjacentCount = 0;
    let overlaps = 0;

    for (const [ax, az] of blocksA) {
        const gx = Math.round(ax / g);
        const gz = Math.round(az / g);

        if (bSet.has(`${gx},${gz}`)) overlaps++;

        for (const [dx, dz] of [[1,0],[-1,0],[0,1],[0,-1]]) {
            if (bSet.has(`${gx + dx},${gz + dz}`)) adjacentCount++;
        }
    }

    return { connected: adjacentCount > 0 && overlaps === 0, adjacentCount, overlaps };
}
