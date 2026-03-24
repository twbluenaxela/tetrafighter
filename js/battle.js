/**
 * Tetris-style connection detection.
 *
 * Win condition: 3+ adjacent faces between your blocks and the opponent's.
 * This rewards wrapping/clamping moves (J, L, T shapes) over head-on bumps.
 *
 * Returns per-side adjacency so the collision system can determine
 * who is dominating the connection.
 */

const CONNECTION_GRID = 0.5;

/**
 * Check connection between two sets of world-space blocks.
 *
 * Returns {
 *   adjacencyA: number of A's block-faces touching B's blocks,
 *   adjacencyB: number of B's block-faces touching A's blocks,
 *   overlaps: number of overlapping positions,
 *   connected: true if either side has 3+ adjacency with no overlaps,
 *   winnerSide: 'a' | 'b' | null — whoever has more surface contact
 * }
 */
export function checkConnection(blocksA, blocksB) {
    const g = CONNECTION_GRID;

    // Build position sets for both sides
    const aSet = new Set();
    blocksA.forEach(([x, z]) => {
        aSet.add(`${Math.round(x / g)},${Math.round(z / g)}`);
    });
    const bSet = new Set();
    blocksB.forEach(([x, z]) => {
        bSet.add(`${Math.round(x / g)},${Math.round(z / g)}`);
    });

    const dirs = [[1,0],[-1,0],[0,1],[0,-1]];

    // Count how many of A's faces touch B
    let adjacencyA = 0;
    for (const [ax, az] of blocksA) {
        const gx = Math.round(ax / g);
        const gz = Math.round(az / g);
        for (const [dx, dz] of dirs) {
            if (bSet.has(`${gx + dx},${gz + dz}`)) adjacencyA++;
        }
    }

    // Count how many of B's faces touch A
    let adjacencyB = 0;
    for (const [bx, bz] of blocksB) {
        const gx = Math.round(bx / g);
        const gz = Math.round(bz / g);
        for (const [dx, dz] of dirs) {
            if (aSet.has(`${gx + dx},${gz + dz}`)) adjacencyB++;
        }
    }

    // Count overlaps
    let overlaps = 0;
    for (const [ax, az] of blocksA) {
        const key = `${Math.round(ax / g)},${Math.round(az / g)}`;
        if (bSet.has(key)) overlaps++;
    }

    const MIN_ADJACENCY = 3;
    const eitherQualifies = (adjacencyA >= MIN_ADJACENCY || adjacencyB >= MIN_ADJACENCY) && overlaps === 0;

    let winnerSide = null;
    if (eitherQualifies) {
        if (adjacencyA > adjacencyB) winnerSide = 'a';
        else if (adjacencyB > adjacencyA) winnerSide = 'b';
        // Tie broken by caller (momentum)
    }

    return {
        adjacencyA,
        adjacencyB,
        overlaps,
        connected: eitherQualifies,
        winnerSide,
    };
}
