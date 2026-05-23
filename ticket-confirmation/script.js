// ========================================
// Particle Background System
// ========================================
class ParticleSystem {
    constructor(canvas) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.particles = [];
        this.mouse = { x: 0, y: 0 };
        this.resize();
        this.init();
        window.addEventListener('resize', () => this.resize());
        window.addEventListener('mousemove', (e) => {
            this.mouse.x = e.clientX;
            this.mouse.y = e.clientY;
        });
    }

    resize() {
        this.canvas.width = window.innerWidth;
        this.canvas.height = window.innerHeight;
    }

    init() {
        const count = Math.min(60, Math.floor((window.innerWidth * window.innerHeight) / 15000));
        for (let i = 0; i < count; i++) {
            this.particles.push({
                x: Math.random() * this.canvas.width,
                y: Math.random() * this.canvas.height,
                vx: (Math.random() - 0.5) * 0.3,
                vy: (Math.random() - 0.5) * 0.3,
                size: Math.random() * 2 + 0.5,
                opacity: Math.random() * 0.15 + 0.05,
                pulse: Math.random() * Math.PI * 2,
            });
        }
    }

    update() {
        this.particles.forEach(p => {
            p.x += p.vx;
            p.y += p.vy;
            p.pulse += 0.01;

            // Wrap around
            if (p.x < 0) p.x = this.canvas.width;
            if (p.x > this.canvas.width) p.x = 0;
            if (p.y < 0) p.y = this.canvas.height;
            if (p.y > this.canvas.height) p.y = 0;

            // Mouse interaction
            const dx = this.mouse.x - p.x;
            const dy = this.mouse.y - p.y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            if (dist < 150) {
                p.vx -= dx * 0.00005;
                p.vy -= dy * 0.00005;
            }
        });
    }

    draw() {
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

        this.particles.forEach(p => {
            const alpha = p.opacity + Math.sin(p.pulse) * 0.1;
            this.ctx.beginPath();
            this.ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
            this.ctx.fillStyle = `rgba(16, 185, 129, ${alpha})`;
            this.ctx.fill();
        });

        // Draw connections
        for (let i = 0; i < this.particles.length; i++) {
            for (let j = i + 1; j < this.particles.length; j++) {
                const a = this.particles[i];
                const b = this.particles[j];
                const dx = a.x - b.x;
                const dy = a.y - b.y;
                const dist = Math.sqrt(dx * dx + dy * dy);
                if (dist < 120) {
                    const alpha = (1 - dist / 120) * 0.05;
                    this.ctx.beginPath();
                    this.ctx.moveTo(a.x, a.y);
                    this.ctx.lineTo(b.x, b.y);
                    this.ctx.strokeStyle = `rgba(16, 185, 129, ${alpha})`;
                    this.ctx.lineWidth = 0.5;
                    this.ctx.stroke();
                }
            }
        }
    }

    animate() {
        this.update();
        this.draw();
        requestAnimationFrame(() => this.animate());
    }
}

// ========================================
// Confetti System
// ========================================
class ConfettiSystem {
    constructor(canvas) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.pieces = [];
        this.gravity = 0.15;
        this.resize();
        window.addEventListener('resize', () => this.resize());
    }

    resize() {
        this.canvas.width = window.innerWidth;
        this.canvas.height = window.innerHeight;
    }

    launch() {
        const colors = [
            '#10b981', '#34d399', '#059669',
            '#06b6d4', '#67e8f9', '#a5f3fc',
            '#a3e635', '#bef264',
            '#fbbf24', '#f59e0b',
            '#f472b6', '#c084fc',
        ];

        for (let i = 0; i < 80; i++) {
            const angle = (Math.random() * Math.PI * 2);
            const velocity = Math.random() * 8 + 4;
            this.pieces.push({
                x: this.canvas.width / 2,
                y: this.canvas.height / 2 - 50,
                vx: Math.cos(angle) * velocity,
                vy: Math.sin(angle) * velocity - 3,
                width: Math.random() * 8 + 4,
                height: Math.random() * 5 + 3,
                color: colors[Math.floor(Math.random() * colors.length)],
                rotation: Math.random() * 360,
                rotationSpeed: (Math.random() - 0.5) * 8,
                opacity: 1,
                decay: Math.random() * 0.008 + 0.003,
            });
        }
    }

    update() {
        this.pieces.forEach(p => {
            p.x += p.vx;
            p.y += p.vy;
            p.vy += this.gravity;
            p.vx *= 0.99;
            p.rotation += p.rotationSpeed;
            p.opacity -= p.decay;
        });
        this.pieces = this.pieces.filter(p => p.opacity > 0);
    }

    draw() {
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        this.pieces.forEach(p => {
            this.ctx.save();
            this.ctx.translate(p.x, p.y);
            this.ctx.rotate((p.rotation * Math.PI) / 180);
            this.ctx.globalAlpha = p.opacity;
            this.ctx.fillStyle = p.color;
            this.ctx.fillRect(-p.width / 2, -p.height / 2, p.width, p.height);
            this.ctx.restore();
        });
    }

    animate() {
        this.update();
        this.draw();
        if (this.pieces.length > 0) {
            requestAnimationFrame(() => this.animate());
        }
    }
}

// ========================================
// Initialize Everything
// ========================================
document.addEventListener('DOMContentLoaded', () => {
    // Particles
    const particleCanvas = document.getElementById('particles');
    const particleSystem = new ParticleSystem(particleCanvas);
    particleSystem.animate();

    // Confetti — launch after checkmark animation
    const confettiCanvas = document.getElementById('confetti');
    const confettiSystem = new ConfettiSystem(confettiCanvas);

    setTimeout(() => {
        confettiSystem.launch();
        confettiSystem.animate();
    }, 1800);

    // Second burst
    setTimeout(() => {
        confettiSystem.launch();
        confettiSystem.animate();
    }, 2400);

    // Button hover ripple effect
    document.querySelectorAll('.action-btn, .email-cta').forEach(btn => {
        btn.addEventListener('mouseenter', (e) => {
            const rect = btn.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const y = e.clientY - rect.top;

            const ripple = document.createElement('div');
            ripple.style.cssText = `
                position: absolute;
                width: 0;
                height: 0;
                border-radius: 50%;
                background: rgba(16, 185, 129, 0.08);
                left: ${x}px;
                top: ${y}px;
                transform: translate(-50%, -50%);
                pointer-events: none;
                transition: all 0.6s ease-out;
            `;
            btn.appendChild(ripple);

            requestAnimationFrame(() => {
                ripple.style.width = '300px';
                ripple.style.height = '300px';
                ripple.style.opacity = '0';
            });

            setTimeout(() => ripple.remove(), 600);
        });
    });

    // Download button click animation
    const downloadBtn = document.getElementById('downloadBtn');
    if (downloadBtn) {
        downloadBtn.addEventListener('click', () => {
            downloadBtn.style.transform = 'scale(0.95)';
            setTimeout(() => {
                downloadBtn.style.transform = '';
            }, 150);
        });
    }

    // Calendar button click animation
    const calendarBtn = document.getElementById('calendarBtn');
    if (calendarBtn) {
        calendarBtn.addEventListener('click', () => {
            calendarBtn.style.transform = 'scale(0.95)';
            setTimeout(() => {
                calendarBtn.style.transform = '';
            }, 150);
        });
    }
});
