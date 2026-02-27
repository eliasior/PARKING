/**
 * Ripple Grid Background Effect
 * Optimized Canvas-based animation that reacts to mouse movement.
 */

const canvas = document.getElementById('ripple-canvas');
const ctx = canvas.getContext('2d');

let width, height, rows, cols;
const gap = 30; // Distance between dots
const dotSize = 1.2;
const rippleRadius = 150;
const mouse = { x: -1000, y: -1000 };

function init() {
    width = window.innerWidth;
    height = window.innerHeight;
    canvas.width = width;
    canvas.height = height;

    cols = Math.ceil(width / gap) + 1;
    rows = Math.ceil(height / gap) + 1;
}

window.addEventListener('resize', init);
window.addEventListener('mousemove', (e) => {
    mouse.x = e.clientX;
    mouse.y = e.clientY;
});

function draw() {
    ctx.clearRect(0, 0, width, height);

    const time = Date.now() * 0.001;

    for (let i = 0; i < cols; i++) {
        for (let j = 0; j < rows; j++) {
            const x = i * gap;
            const y = j * gap;

            // Distance from mouse
            const dx = x - mouse.x;
            const dy = y - mouse.y;
            const dist = Math.sqrt(dx * dx + dy * dy);

            // Ripple effect
            let size = dotSize;
            let opacity = 0.15;
            let offsetX = 0;
            let offsetY = 0;

            if (dist < rippleRadius) {
                const force = (rippleRadius - dist) / rippleRadius;
                opacity = 0.15 + (force * 0.5);
                size = dotSize + (force * 1.5);

                // Subtle displacement
                offsetX = (dx / dist) * force * 10;
                offsetY = (dy / dist) * force * 10;
            }

            // Gentle wave animation
            const wave = Math.sin(time + (i * 0.2) + (j * 0.1)) * 2;

            ctx.beginPath();
            ctx.arc(x + offsetX, y + offsetY + wave, size, 0, Math.PI * 2);
            ctx.fillStyle = `rgba(0, 212, 255, ${opacity})`;
            ctx.fill();
        }
    }

    requestAnimationFrame(draw);
}

init();
draw();
