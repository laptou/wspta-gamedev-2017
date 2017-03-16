/// <reference path="http://pixijs.download/release/pixi.js" />
/// <reference path="https://cdnjs.cloudflare.com/ajax/libs/howler/2.0.2/howler.js" />
/// <reference path="lib/dust.js" />

let PI2 = Math.PI * 2,
    PI = Math.PI,
    PI1_2 = Math.PI * 0.5;

let ENEMY_TYPE = { EATER: 0, TELEPORTEX: 1, BLACKHOLE: 2, MINIMAZE: 3 };

var vector = {
    mult: function multiply(vec, x) {
        return { x: vec.x * x, y: vec.y * x };
    },
    elemMult: function elementwiseMultiply(veca, vecb) {
        return { x: veca.x * vecb.x, y: veca.y * vecb.y };
    },
    dot: function dot(veca, vecb) {
        return veca.x * vecb.x + veca.y * vecb.y;
    },
    sub: function subtract(veca, vecb) {
        return { x: veca.x - vecb.x, y: veca.y - vecb.y };
    },
    add: function add(veca, vecb) {
        return { x: veca.x + vecb.x, y: veca.y + vecb.y };
    },
    neg: function subtract(vec) {
        return { x: -vec.x, y: -vec.y };
    },
    len: function length(vec) {
        return Math.sqrt(vector.dot(vec, vec));
    },
    rot: function rotate(vec, theta) {
        var s = Math.sin(theta);
        var c = Math.cos(theta);
        return { x: vec.x * c - vec.y * s, y: vec.x * s + vec.y * c };
    },
    norm: function normalise(vec) {
        return vector.mult(vec, 1 / (vector.len(vec) || 1));
    }
};

var keyboard = function keyboard(keyCode)  {
    var key = {};
    key.code = keyCode;
    key.isDown = false;
    key.isUp = true;
    key.press = undefined;
    key.release = undefined;
    //The `downHandler`
    key.downHandler = function (event) {
        if (event.keyCode === key.code) {
            if (key.isUp && key.press) key.press();
            key.isDown = true;
            key.isUp = false;

            event.preventDefault();
        }
    };

    //The `upHandler`
    key.upHandler = function (event) {
        if (event.keyCode === key.code) {
            if (key.isDown && key.release) key.release();
            key.isDown = false;
            key.isUp = true;

            event.preventDefault();
        }
    };

    //Attach event listeners
    window.addEventListener(
      "keydown", key.downHandler.bind(key), false
    );
    window.addEventListener(
      "keyup", key.upHandler.bind(key), false
    );
    return key;
};

class Vector {
    constructor(x, y) {
        this.x = x;
        this.y = y;
    }

    //toPolarVector() {
    //    return new PolarVector(vector.len(this), Math.atan2(this.y, this.x));
    //}
}

class InvertFilter extends PIXI.Filter {
    constructor() {
        super();
        this.fragmentSrc = [
                'varying vec2 vTextureCoord;',
                'uniform sampler2D uSampler;',
                'varying vec2 vFilterCoord;',
                'uniform sampler2D filterSampler;',
                'void main(void) {',
                '   vec4 masky = texture2D(filterSampler, vFilterCoord);',
                '   gl_FragColor = texture2D(uSampler, vTextureCoord);',
                '   gl_FragColor.rgb = vec3(1)-gl_FragColor.rgb;',
                '   gl_FragColor = mix(gl_FragColor, masky, 1.0-gl_FragColor.a);',
                '}'
        ].join('\n');
    }
}

class NoiseFilter extends PIXI.Filter {
    constructor() {
        super();
        this.fragmentSrc = [
            "precision mediump float;",
            "varying vec2 vTextureCoord;",
            "varying vec4 vColor;",
            "uniform sampler2D uSampler;",
            "uniform float noise;",

            // The interval is from 0.0 to 1.0
            "float rand(vec2 co) {",
            "      return fract(sin(dot(co.xy, vec2(12.9898, 78.233))) * 43758.5453);",
            "}",

            "void main(void) {",
            "    gl_FragColor = texture2D(uSampler, vTextureCoord);",
            "    float delta = (rand(vTextureCoord) * 0.5) * noise;",
            "    gl_FragColor.r += delta;",
            "    gl_FragColor.g += delta;",
            "    gl_FragColor.b += delta;",
            "}"].join("\n");
    }

    get noise() {
        return this.uniforms.noise;
    }

    set noise(val) {
        this.uniforms.noise = val;
    }
}

class SoundManager {
    constructor() {
        this.sounds = {};
        this.extensions = [];
    }

    get(id) {
        return this.sounds[id];
    }

    add(id, path) {
        this.sounds[id] = new Howl({ src: this.extensions.map(ex => path + "." + ex) });
        return this;
    }
}

class Game {
    constructor() {
        this.view = {
            screen: document.getElementById('screen'),
            pause: document.getElementById('paused'),
            sound: {
                ambient: document.getElementsByClassName('setting-sound')[0],
                game: document.getElementsByClassName('setting-sound')[1]
            }
        };

        var setting = localStorage.getItem("settings");
        this.setting = setting ? JSON.parse(setting) : {
            sound: {
                ambient: true,
                game: true
            }
        };

        var self = this;
        this.view.sound.ambient.checked = this.setting.sound.ambient;
        this.view.sound.ambient.onchecked = evt => { self.setting.sound.ambient = self.view.sound.ambient.checked; self.save(); };
        this.view.sound.game.checked = this.setting.sound.game;
        this.view.sound.game.onchecked = evt => { self.setting.sound.game = self.view.sound.game.checked; self.save(); };

        this.scale = window.devicePixelRatio;

        var clientWidth = this.view.screen.clientWidth;
        var height = window.innerHeight - this.view.screen.clientTop;

        this.resolution = { x: clientWidth, y: height };
        this.origin = { x: 0, y: 0 };
        this.camera = { x: 0, y: 0 };

        this.time = { start: -1, last: 0, stage: 0 };

        this.loaded = false;
        this.paused = false;

        this._score = 0;
        this._sessionScore = 0;
        this.highScore = localStorage.getItem("highscore") || 0;
        this.newHigh = false;

        this.root = new PIXI.Container();

        this.renderer = PIXI.autoDetectRenderer(this.resolution.x, this.resolution.y, { resolution: this.scale });
        this.renderer.autoResize = true;
        this.dust = new Dust(PIXI);

        this.sprite = {};
        this.stage = 0;
        this.stages = [new SplashScreen(this), new MazeScreen(this)];

        this.sound = new SoundManager();
        this.sound.extensions = ["ogg"];

        this.levelGenerated = false;

        this.view.screen.appendChild(this.renderer.view);
    }

    load() {
        var particle = new PIXI.Graphics();
        particle.beginFill(0xFFFFFF);
        particle.drawCircle(5, 5, 5);
        particle.endFill();

        PIXI.utils.TextureCache["particle"] = particle.generateCanvasTexture(PIXI.SCALE_MODES.LINEAR);

        this.init();
    }

    init() {
        var keystate = { left: false, right: false, up: false, down: false };
        this.keystate = keystate;

        var left = keyboard(37),
              up = keyboard(38),
              right = keyboard(39),
              down = keyboard(40);

        left.press = () => keystate.left = true;
        left.release = () => keystate.left = false;
        right.press = () => keystate.right = true;
        right.release = () => keystate.right = false;
        up.press = () => keystate.up = true;
        up.release = () => keystate.up = false;
        down.press = () => keystate.down = true;
        down.release = () => keystate.down = false;

        this.stages[this.stage].load();
        this.stages[this.stage].enter();
    }

    getTime() {
        return (performance.now() - this.time.start) / 1000;
    }

    update(time) {
        var dtime = time - this.time.last;

        if (!this.stages[this.stage].running) {
            this.stage++;
            this.stages[this.stage].load();
            this.stages[this.stage].enter();
        }

        this.dust.update();
        this.stages[this.stage].update(time, dtime);
        

        this.time.last = time;
    }

    render(ptime) {
        this.update(this.getTime());
        this.hAnimFrame = requestAnimationFrame(this.render.bind(this));

        this.renderer.render(this.stages[this.stage].root, null, true);
    }

    start() {
        this.time.start = performance.now();
        this.render(this.time.start);
    }

    enter() {
        this.entered = true;
    }

    stop() {
        cancelAnimationFrame(this.hAnimFrame);
    }

    save() {
        localStorage.setItem("setting", this.setting);
    }

    saveScore() {
        localStorage.setItem("highscore", this.highScore);
    }

    get score() { return this._score; }
    set score(value) {
        this._score = value;

        if (value > this._sessionScore) {
            this._sessionScore = value;
        }

        if(value > this.highScore)
        {
            this.highScore = value;
            localStorage.setItem("highscore", this.highScore);
            this.newHigh = true;
        }
    }

    generateLevel() {
        if (this.levelGenerated) return;
        this.levelGenerated = true;
    }
}

class Screen {
    /**
     *
     * @param {Game} game
     */
    constructor(game) {
        this.game = game;
        this.root = new PIXI.Container();
        this.running = false;
        this.beginTime = -1;
    }

    load() {
    }

    init(data) {
    }

    enter(time) {
        this.running = true;
        this.beginTime = time;
    }

    exit() {
        this.running = false;
    }

    update(time, dtime) {
    }
}

class SplashScreen extends Screen {
    /**
     *
     * @param {Game} game
     */
    constructor(game) {
        super(game);
        this.camera = { x: this.game.resolution.x / 2, y: this.game.resolution.y / 2 };
        this.exitTime = null;
    };

    load() {
        this.game.sound
            .add("blackhole", "/sound/blackhole")
            .add("checkpoint", "/sound/checkpoint")
            .add("pop", "/sound/pop")
            .add("scream", "/sound/scream")
            .add("stone1", "/sound/stone1")
            .add("stone2", "/sound/stone2")
            .add("stone3", "/sound/stone3")
            .add("stone4", "/sound/stone4")
            .add("swish", "/sound/swish")
            .add("touch", "/sound/touch")
            .add("wind", "/sound/wind");

        PIXI.loader
            .add("glow", "/img/sprite/glowie.png")
            .add("light", "/img/sprite/glowie-light.png")
            .add("wall", "/img/sprite/wall.png")
            .add("eye", "/img/sprite/eye.png")
            .add("empty-eye", "/img/sprite/blackeye.png")
            .add("pupil", "/img/sprite/pupil.png")
            .add("mouth", "/img/sprite/mouth.png")
            .add("teleportex", "/img/sprite/teleportex.png")
            .add("blackhole", "/img/sprite/blackhole.png")
            .add("logo", "/img/sprite/logo.png")
            .add("checkpoint", "/img/sprite/checkpoint.png")
            .add("checkpoint-active", "/img/sprite/checkpoint-active.png")
            .add("radiation", "/img/sprite/radiation.png")
            .add("minimaze", "/img/sprite/minimaze.png")
            .load(this.init.bind(this));
    }

    init() {
        this.splash = new PIXI.Text("SCLERO", {
            fill: "white", fontFamily: "Roboto", fontStyle: "bold", fontSize: "144pt", align: "center",
            stroke: "black", strokeThickness: 5
        });
        this.splash.anchor.set(0.5);

        this.instructions = new PIXI.Text("click to begin // arrow keys to move // try to escape", {
            fill: "white", fontFamily: "Roboto", fontStyle: "bold", fontSize: "18pt", align: "center",
            stroke: "black", strokeThickness: 5
        });
        this.instructions.anchor.set(0.5);


        this.maze = new Maze(this.game, false, 1, 1);
        this.maze.activate(0, this.root);
        this.root.addChild(this.splash);
        this.root.addChild(this.instructions);
        this.instructions.position.y += 140;

        this.root.interactive = true;
        this.root.addListener('click', this.beginExit.bind(this));
    }

    beginExit() {
        this.exitTime = this.game.getTime();
    }

    update(time, dtime) {
        if (!this.maze) return;
        if (this.exitTime) {
            if (time - this.exitTime < 1) {
                this.root.alpha = 1 - time + this.exitTime;
            } else {
                this.exit();
            }
        }
        
        this.maze.update(time, dtime);
        this.maze.group.rotation += -0.5 * dtime;

        this.root.localTransform.identity();

        var cameraTarget = { x: this.game.resolution.x / 2, y: this.game.resolution.y / 2 };
        var cameraDist = vector.sub(cameraTarget, this.camera);
        this.camera = vector.add(this.camera, vector.mult(cameraDist, dtime * 5));

        this.root.position.set(this.camera.x, this.camera.y);
    }
}

class MazeScreen extends Screen {
    /**
     *
     * @param {Game} game
     */
    constructor(game) {
        super(game);
        this.camera = { x: this.game.resolution.x / 2, y: this.game.resolution.y / 2 }
        this.paused = false;
        this.stage = new PIXI.Container();
    };

    load() {
        this.init();
    }

    init() {
        this.root.addChild(this.stage);

        var f5 = keyboard(116),
              esc = keyboard(27);

        f5.press = () => !this.state.paused ? this.maze.player.die(new Date().getTime() / 1000 - this.beginTime) : null;
        esc.press = () => this.pause();

        this.maze = new Maze(this.game, false, 1, 3);
        this.maze.onhandoff = newMaze => this.maze = newMaze;
        this.maze.activate(0, this.stage);

        this.scoreboard = new PIXI.Container();
        // this.scoreboard.anchor.set(1, 0);

        this.scoreText = new PIXI.Text("0", {
            fill: "white", fontFamily: "Roboto", fontStyle: "bold", fontSize: "48pt", align: "right",
            strokeThickness: "5"
        });
        this.scoreText.anchor.set(1, 0);
        this.scoreboard.addChild(this.scoreText);
        
        this.highScoreText = new PIXI.Text(`high score: ${this.game.highScore}`, {
            fill: "white", fontFamily: "Roboto", fontStyle: "bold", fontSize: "24pt", align: "right",
            strokeThickness: "5"
        });
        this.highScoreText.anchor.set(1, 0);
        this.highScoreText.scale.set(100 / this.highScoreText.width);
        this.highScoreText.position.set(0, 40 / this.highScoreText.scale.y);

        this.scoreboard.addChild(this.highScoreText);
        this.scoreboard.position.set(this.game.resolution.x - this.scoreboard.width - 10, 10);

        this.root.addChild(this.scoreboard);
    }

    update(time, dtime) {
        if (!this.maze) return;
        if (this.paused) return;

        this.maze.update(time, dtime);
        this.scoreText.text = this.game.score.toString();
        this.highScoreText.text = `high score: ${this.game.highScore}`;
        if (this.game.newHigh)
            this.highScoreText.tint = 0x89ff89;

        var playerPos = {
            x: this.maze.player.sprite.worldTransform.tx - this.stage.x,
            y: this.maze.player.sprite.worldTransform.ty - this.stage.y
        };

        this.stage.localTransform.identity();

        var cameraTarget = { x: -playerPos.x + this.game.resolution.x / 2, y: -playerPos.y + this.game.resolution.y / 2 };
        var cameraDist = vector.sub(cameraTarget, this.camera);
        this.camera = vector.add(this.camera, vector.mult(cameraDist, dtime * 5));

        this.stage.position.set(this.camera.x, this.camera.y);
    }

    pause() {
        this.paused = !this.paused;
        this.game.view.pause.style.visibility = this.paused ? 'visible' : 'hidden';
        this.game.view.pause.style.opacity = this.paused ? 1 : 0;
    }
}

class Bouncer {
    /**
     *
     * @param {Game} game
     * @param {Maze} maze
     * @param {ENEMY_TYPE} type
     */
    constructor(game, maze, type) {
        this._x = new Vector(0, 0);
        this._v = new Vector(0, 0);

        this.type = type;
        var types = [
            "mouth",
            "teleportex",
            "blackhole",
            "minimaze"
        ];
        var tex = PIXI.utils.TextureCache[types[type]];
        this.sprite = new PIXI.Sprite(tex);

        this.sprite.width = this.sprite.height = 40 * game.scale;
        this.sprite.anchor.set(0.5);
        this.hitCircle = new PIXI.Circle(this.position.x, this.position.y, this.sprite.width / 2);
        this.active = true;

        if (type === ENEMY_TYPE.BLACKHOLE) {
            this.radiationCircle = new PIXI.Sprite(PIXI.utils.TextureCache["/img/sprite/radiation.png"]);
            this.radiationCircle.scale.set(0);
            this.radiationCircle.anchor.set(0.5);

            this.sprite.addChild(this.radiationCircle);
        }

        if (type === ENEMY_TYPE.MINIMAZE && maze.levels > 0) {
            this.outerMaze = maze;
            this.miniMaze = new Maze(game, !maze.inverted, maze.level + 1, maze.levels - 1, this);
        }
    }

    get velocity() {
        return this._v;
    }
    set velocity(velocity) { this._v = velocity; }
    get position() { return this._x; }
    set position(position) { this._x = position; }

    get x() {
        return this._x.x;
    }

    set x(x) {
        this._x.x = x;

        if (this.sprite)
            this.sprite.x = this.hitCircle.x = x;
    }

    get y() {
        return this._x.y;
    }

    set y(y) {
        this._x.y = y;

        if (this.sprite)
            this.sprite.y = this.hitCircle.y = y;
    }
}

class Checkpoint {
    /**
     * 
     * @param {Maze} maze The maze that this checkpoint is inside of.
     * @param {Number} index The checkpoint number.
     */
    constructor(maze, index) {
        this._x = 0;
        this._y = 0
        this._trailContainer = maze.trailContainer;

        this.markTime = -1;
        this.marked = false;
        this.index = index;
        this.maze = maze;
        this.game = maze.game;

        this.inactiveSprite = new PIXI.Sprite(PIXI.utils.TextureCache["checkpoint"]);
        this.activeSprite = new PIXI.Sprite(PIXI.utils.TextureCache["checkpoint-active"]);

        this.activeSprite.alpha = 0;

        this.inactiveSprite.width = this.inactiveSprite.height =
        this.activeSprite.width = this.activeSprite.height = 40 * game.scale;

        var style = {
            fontFamily: 'Roboto Condensed',
            fontSize: `${10 * game.scale}px`,
            fill: 'white'
        };

        this.label = new PIXI.Text(`CHECKPOINT ${index}`, style);
        this.label.anchor.set(0.5);
        this.label.alpha = 0;
        this.label.y = -40 * game.scale;

        this.inactiveSprite.anchor.set(0.5);
        this.activeSprite.anchor.set(0.5);
        this.hitCircle = new PIXI.Circle(this.x, this.y, 20 * game.scale);
    }

    mark(time) {
        if (this.marked) return false;

        if (this.maze.game.setting.sound.game)
            this.game.sound.sounds["checkpoint"].play();

        this.marked = true;
        this.markTime = time;

        game.dust.create(
            this.x,                                    //x start position
            this.y,                                    //y start position
            () => new PIXI.Sprite(PIXI.utils.TextureCache["particle"]),
            this._trailContainer,                         //Container for particles
            30,                                      //Number of particles
            0,                                    //Gravity
            true,                                   //Random spacing
            0, 6.28,           //Min/max angle
            2, 7,                                 //Min/max size
            1, 2,                                   //Min/max speed
            0.005, 0.01,                            //Min/max game.scale speed
            0.005, 0.01,                            //Min/max alpha speed
            0.05, 0.1                               //Min/max rotation speed
        );

        return true;
    }

    get x() {
        return this._x;
    }

    set x(x) {
        this._x = x;

        if (this.inactiveSprite) {
            this.inactiveSprite.x = this.activeSprite.x = this.hitCircle.x = x;
            this.label.x = x;
        }
    }

    get y() {
        return this._y;
    }

    set y(y) {
        this._y = y;

        if (this.inactiveSprite) {
            this.inactiveSprite.x = this.activeSprite.x = this.hitCircle.y = y;
            this.label.y = y - 40 * game.scale;
        }
    }
}

class Eye {
    /**
     *
     * @param {Game} game The game that this Eye is part of.
     */
    constructor(game) {
        this._game = game;

        this._baseSprite = new PIXI.Sprite(PIXI.utils.TextureCache["empty-eye"]);
        this._baseSprite.anchor.set(0.5);
        this._pupilSprite = new PIXI.Sprite(PIXI.utils.TextureCache["pupil"]);
        this._pupilSprite.anchor.set(0.5);
        this._baseSprite.addChild(this._pupilSprite);
    }

    /**
     * Updates the eye to look at the player.
     * @param {Player} player The player which the eye is looking at.
     */
    update(player) {
        var rot = this._baseSprite.parent.rotation;
        var pos = { x: this._baseSprite.parent.x, y: this._baseSprite.parent.y };
        var ppos = { x: player.x, y: player.y };

        this._baseSprite.rotation = -rot;

        var dir = vector.norm(vector.sub(ppos, pos));
        // dir = vector.rot(dir, -rot);
        this._pupilSprite.x = dir.x * 5;
        this._pupilSprite.y = dir.y * 2.5;
    }
}

class Player {
    /**
     *
     * @param {Game} game The game instance in which this player belongs.
     * @param {Maze} maze
     */
    constructor(game, maze) {
        this.game = game;
        this.maze = maze;

        var colour = 0xFFFFFF;

        var playerTex = PIXI.utils.TextureCache["glow"];

        var playerLight = new PIXI.Sprite(PIXI.utils.TextureCache["light"]);
        var player = new PIXI.Sprite(playerTex);
        player.height *= game.scale;
        player.width *= game.scale;
        player.anchor.set(0.5);

        this.vx = this.vy = 0;

        this.hitCircle = new PIXI.Circle(player.x, player.y, 15);

        playerLight.anchor.set(0.5);

        this.light = playerLight;

        var playerCircle = new PIXI.Graphics();
        playerCircle.beginFill(colour, 1);
        playerCircle.drawCircle(0, 0, 15);
        playerCircle.endFill();
        this.circle = playerCircle;
        player.addChild(this.circle);

        player.addChild(playerLight);

        this.sprite = player;
    }

    get x() {
        return this.sprite.x;
    }

    set x(value) {
        this.sprite.x = value;
    }

    get y() {
        return this.sprite.y;
    }

    set y(value) {
        this.sprite.y = value;
    }

    update(time, dtime) {
        if (this.dead) {
            var t = time - this.timeOfDeath;

            if (t <= 0.1)
                this.sprite.scale.set(this.game.scale - t * 10 * this.game.scale);
            else if (t <= 0.2) {
                this.sprite.scale.set(t * 10 * this.game.scale - this.game.scale);
                this.sprite.x = this.maze.lastCheckpoint ? this.maze.lastCheckpoint.x : 0;
                this.sprite.y = this.maze.lastCheckpoint ? this.maze.lastCheckpoint.y : 0;
                this.vx = 0;
                this.vy = 0;
            } else {
                this.sprite.scale.set(this.game.scale);
                this.dead = false;
            }

            return;
        }

        let acc = 1000, fric = 3.0;

        if (this.game.ptr) {
            this.vx += ptr.x / Math.abs(ptr.x) * dtime * acc;
            this.vy += ptr.y / Math.abs(ptr.y) * dtime * acc;
        } else {
            if (this.game.keystate.left)
                this.vx -= acc * dtime;
            if (this.game.keystate.right)
                this.vx += acc * dtime;
            if (this.game.keystate.down)
                this.vy += acc * dtime;
            if (this.game.keystate.up)
                this.vy -= acc * dtime;
        }

        var dx = { x: this.vx * dtime * this.game.scale, y: this.vy * dtime * this.game.scale };

        this.x += dx.x;
        this.y += dx.y;

        this.vx -= this.vx * fric * dtime;
        this.vy -= this.vy * fric * dtime;

        this.sprite.rotation += Math.PI * dtime;

        var pulse = 0.9 + Math.sin(time * Math.PI) * 0.1;
        this.light.scale.set(
            Math.max(pulse / Math.max(vector.len({ x: this.x, y: this.y }) / 400 * this.game.scale, 0.0001),
            0.2 * this.game.scale));
        this.sprite.alpha = pulse;

        if (this.teleportTime) {
            this.sprite.scale.set(Math.min(1, 5 * Math.sqrt(time - this.teleportTime)));
        }

        this.hitCircle.x = this.x;
        this.hitCircle.y = this.y;

        var hit = this.maze.collidesCircle(this.hitCircle);
        dx = this.processHit(this, time, dtime, hit, dx) || dx;

        this.hitCircle.x = this.x;
        this.hitCircle.y = this.y;

        hit = this.maze.collidesWall(this.hitCircle);
        this.processHit(this, time, dtime, hit, dx);
        //#endregion
    }

    die(time) {
        if (this.dead) return;

        this.timeOfDeath = time;
        this.dead = true;

        this.vx = 0;
        this.vy = 0;

        this.game.sound.sounds["swish"].rate = 3;
        if (this.game.setting.sound.game)
            this.game.sound.sounds["swish"].play();

        this.game.dust.create(
            this.x,                                    //x start position
            this.y,                                    //y start position
            () => new PIXI.Sprite(PIXI.utils.TextureCache["particle"]),
            this.maze.trailContainer,                         //Container for particles
            100,                                      //Number of particles
            0,                                    //Gravity
            true,                                   //Random spacing
            0, 6.28,           //Min/max angle
            2, 7,                                 //Min/max size
            1, 10,                                   //Min/max speed
            0.005, 0.01,                            //Min/max game.scale speed
            0.005, 0.01,                            //Min/max alpha speed
            0.05, 0.1                               //Min/max rotation speed
        );
    }

    teleport(pos, time) {
        this.game.dust.create(
            this.x,                                    //x start position
            this.y,                                    //y start position
            () => new PIXI.Sprite(PIXI.utils.TextureCache["particle"]),
            this.maze.trailContainer,                         //Container for particles
            20,                                      //Number of particles
            0,                                    //Gravity
            true,                                   //Random spacing
            0, 6.28,           //Min/max angle
            2, 7,                                 //Min/max size
            1, 4,                                   //Min/max speed
            0.005, 0.01,                            //Min/max game.scale speed
            0.005, 0.01,                            //Min/max alpha speed
            0, 0                               //Min/max rotation speed
        );

        this.x = pos.x;
        this.y = pos.y;
        this.sprite.scale.set(0);
        this.teleportTime = time;

        if (this.game.setting.sound.game)
            this.game.sound.sounds["pop"].play();

        this.game.dust.create(
            this.x,                                    //x start position
            this.y,                                    //y start position
            () => {
                var sprite = new PIXI.Sprite(PIXI.utils.TextureCache["particle"]);
                sprite.alpha = 0.8;
                return sprite;
            },
            this.maze.trailContainer,                         //Container for particles
            20,                                      //Number of particles
            0,                                    //Gravity
            true,                                   //Random spacing
            0, 6.28,           //Min/max angle
            2, 7,                                 //Min/max size
            1, 4,                                   //Min/max speed
            0.005, 0.01,                            //Min/max game.scale speed
            0.005, 0.01,                            //Min/max alpha speed
            0, 0                               //Min/max rotation speed
        );
    }

    spark(normal, time) {
        var nnormal = vector.norm(normal);
        var angle = Math.atan2(nnormal.y, nnormal.x);

        if (this.game.setting.sound.game) {
            if (this.game.sound.sounds["touch"].seek() > 0.2 || !this.game.sound.sounds["touch"].playing()) {
                this.game.sound.sounds["touch"].play();
            }
        }

        this.game.dust.create(
            this.x - this.hitCircle.radius * nnormal.x, // x
            this.y - this.hitCircle.radius * nnormal.y, // y
            () => new PIXI.Sprite(PIXI.utils.TextureCache["particle"]),
            this.maze.trailContainer,                         //Container for particles
            10,                                      //Number of particles
            0,                                    //Gravity
            true,                                   //Random spacing
            angle - 0.3, angle + 0.3,           //Min/max angle
            2, 7,                                 //Min/max size
            1, 0.02 * vector.len({ x: this.vx, y: this.vy }),                                   //Min/max speed
            0.005, 0.01,                            //Min/max game.scale speed
            0.005, 0.01,                            //Min/max alpha speed
            0.05, 0.1                               //Min/max rotation speed
        );
    }

    processHit(player, time, dtime, hit, dx) {
        if (hit) {
            player.x -= dx.x;
            player.y -= dx.y;

            var n = hit.normal;
            var v = { x: player.vx, y: player.vy };

            if (hit.velocity) {
                v = vector.sub(v, hit.velocity);
            }

            var v1 = vector.neg(vector.sub(vector.mult(n, 2 * vector.dot(n, v)), v)); //  −(2(n · v) n − v)

            if (!this.sparkedLastFrame)
                player.spark(hit.normal, time);

            player.vx = v1.x;
            player.vy = v1.y;

            this.sparkedLastFrame = true;

            if (hit.intersection) {
                var displacement = vector.mult(vector.norm(hit.normal), hit.intersection);
                player.x += displacement.x;
                player.y += displacement.y;
            }

            dx = { x: player.vx * dtime * game.scale, y: player.vy * dtime * game.scale };

            player.x += dx.x;
            player.y += dx.y;

            return dx;
        } else {
            this.sparkedLastFrame = false;
        }
    }
}

class Maze {
    /**
     * Constructs a new Maze.
     * @param {Game} game The game to which this Maze belongs.
     * @param {Boolean} invertedColours Whether or not this maze is inverted.
     * @param {Number} level The number of mazes deep this maze is.
     * @param {Bouncer} parent The bouncer that this minimaze is a child of.
     */
    constructor(game, invertedColours, level, levels, parent) {
        this.game = game;
        this.level = level;
        this.levels = levels;
        this.inverted = invertedColours;
        this.parent = parent;
        this.child = null;
        this.onhandoff = null;

        let gapWidth = 120 * game.scale, strokeWidth = 30 * game.scale, mazeSize = Math.floor(15 / level);
        var mazeTex = new PIXI.Graphics(), background = new PIXI.Graphics(), mask = new PIXI.Graphics();
        this.structure = [];
        this.radius = (100 + 200 * mazeSize) * game.scale;

        background.beginFill(0x000000);
        background.drawCircle(0, 0, (200 + 200 * mazeSize) * game.scale);
        background.endFill();

        mask.beginFill(0x000000);
        mask.drawCircle(0, 0, (200 + 200 * mazeSize) * game.scale);
        mask.endFill();

        mazeTex.lineStyle(strokeWidth, 0xFFFFFF);

        for (var i = 0; i <= mazeSize; i++) {
            var radius = (100 + 200 * i) * game.scale;
            var circumference = PI2 * radius;
            var numGaps = Math.ceil((i + 1) / 6);
            var angularWidth = gapWidth / circumference * PI2;
            var gaps = [];

            var offset = Math.random() * (PI2 - angularWidth);
            var end = offset + angularWidth;

            for (var g = 0; g < numGaps; g++) {
                var gap = { offset: offset + PI2 / numGaps * g, end: offset + PI2 / numGaps * g + angularWidth };
                if (gap.offset > PI2) {
                    gap.offset -= PI2;
                    gap.end -= PI2;
                }
                gaps.push(gap);
            }

            gaps.sort((x, y) => x.offset < y.offset ? -1 : 1);

            mazeTex.moveTo(Math.cos(end) * radius, -Math.sin(end) * radius); // invert Y coord so it makes sense in my brain

            var segmentCount = Math.ceil(circumference / 20 / game.scale * numGaps);
            for (var j = 0; j < numGaps; j++) {
                var g0 = gaps[j];
                var g1;
                if (j + 1 < gaps.length)
                    g1 = gaps[j + 1];
                else
                    g1 = { offset: gaps[0].offset + PI2, end: gaps[0].end + PI2 };

                var length = g1.offset - g0.end;

                mazeTex.moveTo(Math.cos(g0.end) * radius, -Math.sin(g0.end) * radius);

                var st = Math.ceil(segmentCount / numGaps);
                for (var s = 0; s <= st; s++) {
                    mazeTex.lineTo(Math.cos(g0.end + length * s / st) * radius, -Math.sin(g0.end + length * s / st) * radius);
                }
            }

            this.structure.push({ radius: radius, gaps: gaps, stroke: strokeWidth });
        }

        var filters = [];

        if (this.inverted) {
            filters.push(new InvertFilter());
        }

        var noise = new NoiseFilter();
        noise.noise = (level - 1) / 3;

        this.sprite = mazeTex;

        this.player = new Player(game, this);
        this.sprite.mask = this.player.light;

        this.group = new PIXI.Container();
        this.noiseGroup = new PIXI.Container();
        // this.noiseGroup.filters = [noise];

        this.noiseGroup.addChild(background);

        this.trailContainer = new PIXI.particles.ParticleContainer(1000 * game.scale, { alpha: true });

        this.noiseGroup.addChild(this.player.sprite);
        this.noiseGroup.addChild(this.sprite);
        this.noiseGroup.addChild(this.trailContainer);

        this.group.addChild(mask);
        this.group.addChild(this.noiseGroup);

        //this.noiseGroup.x = -this.noiseGroup.width / 2;
        //this.noiseGroup.y = -this.noiseGroup.height / 2;

        this.group.mask = mask;
        this.group.filters = filters;
        //#endregion

        //#region walls
        var walls = new PIXI.Container();
        {
            for (var i = 1; i < mazeSize; i++) {
                var ringIdx = mazeSize - i;
                var radius = (200 + 200 * ringIdx) * this.game.scale;

                var wall = new PIXI.Sprite(PIXI.utils.TextureCache["wall"]);
                var position = Math.random() * PI2;

                wall.width *= game.scale;
                wall.height *= game.scale;
                wall.anchor.set(0.5);
                wall.rotation = position + PI1_2;
                wall.radius = radius;
                wall.vr = 0;
                wall.y = Math.sin(wall.rotation - PI1_2) * radius;
                wall.x = Math.cos(wall.rotation - PI1_2) * radius;

                var eye = new Eye(game);

                wall.eye = eye;
                wall.addChild(eye._baseSprite);

                walls.addChild(wall);
            }

            this.sprite.addChild(walls);
        }
        //#endregion

        //#region bouncers
        var bouncers = [];
        {
            var bouncerContainer = new PIXI.Container();

            for (var i = 4; i <= mazeSize; i++) {
                var j = i - 4;
                var j2 = j * j;

                for (var k = 0; k < j2; k++) {
                    var a = k / j2 * PI2;
                    var r = (200 * i + 200) * game.scale;

                    var type = -1;
                    var chance = Math.random();
                    if (chance < 0.35 && levels > 0)
                        type = ENEMY_TYPE.MINIMAZE;
                    else if (chance < 0.5)
                        type = ENEMY_TYPE.TELEPORTEX;
                    else if (chance < 0.95)
                        type = ENEMY_TYPE.EATER;
                    else
                        type = ENEMY_TYPE.BLACKHOLE;

                    var bouncer = new Bouncer(game, this, type);

                    bouncer.velocity = new Vector(-Math.sin(a), Math.cos(a)); // 0, 1
                    bouncer.position = new Vector(Math.cos(a) * r, Math.sin(a) * r); // 1, 0

                    bouncers.push(bouncer);
                    this.sprite.addChild(bouncer.sprite);
                }
            }

            // this.sprite.addChild(bouncerContainer);
        }
        //#endregion

        //#region checkpoints
        var checkpoints = [];
        {
            for (var i = 3; i < mazeSize; i += 3) {
                var radius = (200 + 200 * i) * game.scale;
                var checkpoint = new Checkpoint(this, i / 3);
                checkpoint.x = -radius;
                this.sprite.addChild(checkpoint.activeSprite);
                this.sprite.addChild(checkpoint.inactiveSprite);
                this.sprite.addChild(checkpoint.label);
                checkpoints.push(checkpoint);
            }
        }
        //#endregion

        this.enemies = { walls: walls, bouncers: bouncers };
        this.powerups = { checkpoints: checkpoints };
    }

    get x() {
        return this.group.x // + this.group.width / 2 // * this.group.scale.x / 2;
    }

    get y() {
        return this.group.y // + this.group.height / 2 // * this.group.scale.y / 2;
    }

    set x(x) {
        this.group.x = x // - this.group.width / 2 // * this.group.scale.x / 2;
    }

    set y(y) {
        this.group.y = y // - this.group.height / 2 // * this.group.scale.y / 2;
    }

    collidesWall(circle) {
        /// <param name="circle" type="PIXI.Circle"></field>

        var walls = this.enemies.walls;

        for (let wall of walls.children) {
            var wpos2 = vector.rot({ x: wall.x, y: wall.y }, walls.rotation);

            var dist = { x: wpos2.x - circle.x, y: wpos2.y - circle.y };
            var len = vector.len(dist);

            if (len > 100 * game.scale + circle.radius) {
                // if the centre of the circle is this far away, it's not intersecting the wall
                continue;
            } else {
                var theta = -wall.rotation - walls.rotation;
                var st = Math.sin(theta);
                var ct = Math.cos(theta);

                var pos2 = {
                    x: ct * (circle.x - wpos2.x) - st * (circle.y - wpos2.y) + wpos2.x,
                    y: st * (circle.x - wpos2.x) - ct * (circle.y - wpos2.y) + wpos2.y
                };

                // transformed so it's as if the rectangle is not rotated, but the circle is still
                // in the same relative position

                var centre = false;

                if (pos2.x + circle.radius < wpos2.x - 20 * game.scale) {
                    continue;
                } else if (pos2.x - circle.radius > wpos2.x + 20 * game.scale) {
                    continue;
                } else if (pos2.y - circle.radius > wpos2.y + 100 * game.scale) {
                    continue;
                } else if (pos2.y + circle.radius < wpos2.y - 100 * game.scale) {
                    continue;
                }

                var radius = vector.len({ x: wall.position.x, y: wall.position.y });

                // this means the circle is bouncing off the short side, if false
                var notLateral = (pos2.y > wpos2.y - 100 * game.scale &&
                    pos2.y < wpos2.y + 100 * game.scale);

                var normal = { x: 0, y: 0 };
                var intersection = 0;
                var s1 = 0, s2 = 0;

                if (notLateral) {
                    // not lateral, which means the circle is bouncing off the long side

                    normal = { x: Math.cos(-theta), y: Math.sin(-theta) };

                    s1 = (pos2.x + circle.radius) - (wpos2.x - 20 * game.scale);
                    s2 = (pos2.x - circle.radius) - (wpos2.x + 20 * game.scale);

                    intersection = Math.min(Math.abs(s1), Math.abs(s2));
                } else {
                    normal = { x: Math.sin(-theta), y: Math.cos(-theta) };

                    s1 = (pos2.y + circle.radius) - (wpos2.y - 100 * game.scale);
                    s2 = (pos2.y - circle.radius) - (wpos2.y + 100 * game.scale);

                    intersection = Math.min(Math.abs(s1), Math.abs(s2));
                }

                return {
                    normal: normal,
                    intersection: intersection,
                    velocity: { x: wall.vr * radius * Math.cos(-theta), y: wall.vr * radius * Math.sin(-theta) }
                };
            }
        }

        return null;
    }

    collidesCircle(circle, withGaps) {
        /// <param name="circle" type="PIXI.Circle"></field>
        // distance from centre of circle to centre of maze

        withGaps = withGaps === undefined ? true : withGaps;
        var dist = { x: circle.x, y: circle.y };
        var distToCentre = vector.len(dist);

        for (let ring of this.structure) {
        // if the outer edge of the ring is farther from the centre than the closest point on the circle
            if (ring.radius + ring.stroke / 2 >= distToCentre - circle.radius) {
                // and the inner edge of the ring is closer to the center than the farthest point on the circle
                if (ring.radius - ring.stroke / 2 <= distToCentre + circle.radius) {
                    // then the circle intersects the ring unless it is in the gap

                    var angle = Math.atan2(-dist.y, dist.x);
                    angle = angle > 0 ? angle : angle + PI2;

                    var inGap = false;

                    if (withGaps) {
                        for (let gap of ring.gaps) {
                            var end = gap.end;
                            var start = gap.offset;

                            if (angle > start && end > angle) {
                                var cap1 = { x: Math.cos(start) * ring.radius, y: -Math.sin(start) * ring.radius };
                                var cap2 = { x: Math.cos(end) * ring.radius, y: -Math.sin(end) * ring.radius };

                                var dist1 = vector.sub(dist, cap1);
                                var dist2 = vector.sub(dist, cap2);
                                var len1 = vector.len(dist1);
                                var len2 = vector.len(dist2);

                                if (len1 <= ring.stroke) {
                                    return { normal: vector.mult(dist1, 1 / len1) };
                                }

                                if (len2 <= ring.stroke) {
                                    return { normal: vector.mult(dist2, 1 / len2) };
                                }

                                // return false, we're in the gap of a ring
                                return null;
                            }
                        }
                    }

                    if (!inGap) {
                        var normal = { x: dist.x / distToCentre, y: dist.y / distToCentre };

                        var intersection = ring.radius - ring.stroke / 2 - (distToCentre + circle.radius);

                        if (distToCentre < ring.radius) {
                            normal.x = -normal.x;
                            normal.y = -normal.y;
                        }

                        if (intersection < -ring.stroke / 2) {
                            intersection = ring.radius + ring.stroke / 2 - (distToCentre - circle.radius);
                        }

                        return { normal: normal, intersection: intersection };
                    }
                }
            }
        }
        return null;
    }

    activate(time, root) {
        if (this.parent && !this.activationTime) {
            this.group.scale.set(0);
            this.x = this.parent.x;
            this.y = this.parent.y;
        }

        this.activationTime = time;

        this.root = root;
        root.addChild(this.group);
    }

    deactivate(time) {
        this.fadeTime = time;
    }

    update(time, dtime) {
        if (this.child) {
            this.child.update(time, dtime);
            return;
        }
        if (this.parent) {
            if (this.fadeTime) {
                var t = time - this.fadeTime;

                if (t < 1) {
                    this.group.scale.set(Math.max(1 - 2 * Math.sqrt(t) + t, 0));
                    this.sprite.alpha = Math.max(1 - t, 0);
                    this.player.sprite.alpha = Math.max(1 - t, 0);
                } else {
                    this.group.scale.set(0);
                    this.sprite.alpha = 0;
                    this.player.sprite.alpha = 0;
                    this.game.maze = this.parent.outerMaze;
                    this.root.removeChild(this.group);
                    if (this.onhandoff)
                        this.onhandoff(this.parent.outerMaze);
                    return;
                }
            } else {
                if (this.activationTime) {
                    var t = time - this.activationTime;

                    if (t < 1) {
                        this.group.scale.set(Math.min(2 * Math.sqrt(t) - t, 1));
                        this.sprite.alpha = Math.max(t, 0);
                        this.player.sprite.alpha = Math.max(t, 0);
                    } else {
                        this.group.scale.set(1);
                        this.sprite.alpha = 1;
                        this.player.sprite.alpha = 1;
                    }
                }
            }

            //this.x = this.parent.x - this.group.width / 2;
            //this.y = this.parent.y - this.group.height / 2;
        }

        this.player.update(time, dtime);

        this.score();

        var walls = this.enemies.walls,
            bouncers = this.enemies.bouncers,
            checkpoints = this.powerups.checkpoints,
            player = this.player;

        var rotation = Math.max(0, Math.sin(10 * time / PI)) * dtime * 0.25;

        if (rotation > 0 && !this.wallsMoving) {
            this.wallsMoving = true;

            var sfx = Math.floor(Math.random() * 4 + 1);
            //if (game.setting.sound.game)
            //    sounds[`/sound/stone${sfx}.ogg`].play();
        } else if (rotation === 0) {
            this.wallsMoving = false;
        }

        var wallDist = { x: Infinity, y: Infinity };

        for(let wall of walls.children) {
            var dr = rotation / (wall.radius / 2000);
            wall.rotation += dr;
            wall.vr = dr / dtime;
            wall.y = Math.sin(wall.rotation - PI1_2) * wall.radius;
            wall.x = Math.cos(wall.rotation - PI1_2) * wall.radius;
            wall.eye.update(player);

            var playerDist = vector.sub({ x: wall.x, y: wall.y }, { x: player.x, y: player.y });
            var playerDistLen = vector.len(playerDist);

            if (playerDistLen < vector.len(wallDist)) {
                wallDist = playerDist;
            }
        }

        var z = vector.len(wallDist) / 500;
        var p = wallDist.x / 200;

        //sounds["/sound/whispers.ogg"].volume = this.game.setting.sound.game ? Math.min(0.5, 1 / z) : 0;
        //sounds["/sound/whispers.ogg"].pan = 1 / (1 + Math.exp(-p)) - 0.5;

        //sounds["/sound/reverse-whispers.ogg"].volume = this.game.setting.sound.game ? Math.min(0.5, 1 / z) : 0;
        //sounds["/sound/reverse-whispers.ogg"].pan = 1 / (1 + Math.exp(-p)) - 0.5;

        var blackHoleDist = Infinity;

        for (var bouncer of bouncers) {
            if (!bouncer.active) continue;

            bouncer.x += bouncer.velocity.x * dtime;
            bouncer.y += bouncer.velocity.y * dtime;

            var x = bouncer.position;
            var v = bouncer.velocity;

            if (bouncer.type === ENEMY_TYPE.BLACKHOLE) {
                var dl = vector.len(x);

                v.x = -bouncer.y;
                v.y = bouncer.x;

                v = vector.mult(vector.norm(v), 30);

                var t = time % 5;
                var rs = this.inverted ? Math.sqrt(t) / Math.sqrt(5) : 1 - t * t / 25;
                bouncer.radiationCircle.scale.set(rs);
                bouncer.radiationCircle.alpha = Math.max(0, 1 - rs);
            } else {
                v = vector.mult(vector.norm(v), vector.len(x) / 5);
            }

            bouncer.velocity.x = v.x;
            bouncer.velocity.y = v.y;

            var hit = this.collidesCircle(bouncer.hitCircle, false);

            if (hit) {
                bouncer.x -= bouncer.velocity.x * dtime * game.scale;
                bouncer.y -= bouncer.velocity.y * dtime * game.scale;

                var n = hit.normal;
                var v1 = vector.neg(vector.sub(vector.mult(n, 2 * vector.dot(n, v)), v)); //  −(2(n · v) n − v)

                if (hit.velocity) {
                    v1 = vector.add(v1, hit.velocity);
                }

                bouncer.velocity.x = v1.x;
                bouncer.velocity.y = v1.y;

                bouncer.x += bouncer.velocity.x * dtime * game.scale;
                bouncer.y += bouncer.velocity.y * dtime * game.scale;
            }

            var playerDist = vector.sub(bouncer.position, { x: player.x, y: player.y });
            var playerDistLen = vector.len(playerDist);

            var hitPlayer = playerDistLen <= (bouncer.hitCircle.radius + player.hitCircle.radius) * 0.9;

            if (bouncer.type === ENEMY_TYPE.BLACKHOLE && playerDistLen <= 400 * game.scale) {
                var px = playerDist.x / Math.abs(playerDist.x);
                var py = playerDist.y / Math.abs(playerDist.y);

                if (this.inverted) {
                    // black holes become white holes
                    px = -px;
                    py = -py;
                }

                blackHoleDist = Math.min(playerDistLen, blackHoleDist);

                if (px) player.vx += 275 / px * dtime;
                if (py) player.vy += 275 / py * dtime;
            }

            if (bouncer.type === ENEMY_TYPE.TELEPORTEX)
                bouncer.sprite.rotation += PI2 * dtime;
            else if (bouncer.type === ENEMY_TYPE.EATER)
                bouncer.sprite.rotation = Math.atan2(playerDist.y, playerDist.x) + PI1_2;

            if (hitPlayer) {
                switch (bouncer.type) {
                    case ENEMY_TYPE.EATER:
                        player.die(time);
                        break;
                    case ENEMY_TYPE.TELEPORTEX:
                        var pos = { x: player.x, y: player.y };
                        var newPos = vector.mult(vector.norm(pos), vector.len(pos) - 200 * game.scale);
                        player.teleport(newPos, time);
                        break;
                    case ENEMY_TYPE.MINIMAZE:
                        bouncer.miniMaze.activate(time, this.root);
                        if (this.onhandoff) {
                            bouncer.miniMaze.onhandoff = this.onhandoff;
                            this.onhandoff(bouncer.miniMaze);
                        }
                        this.sprite.removeChild(bouncer.sprite);
                        bouncer.active = false;
                        this.child = bouncer.miniMaze;
                        break;
                }
            }
        }

        //sounds["/sound/blackhole.ogg"].volume = this.game.setting.sound.game ? Math.min(1, 200 / blackHoleDist) : 0;

        for(let checkpoint of checkpoints) {
            var chDist = vector.sub({ x: checkpoint.x, y: checkpoint.y }, { x: player.x, y: player.y });
            if (!checkpoint.marked && vector.len(chDist) <= checkpoint.hitCircle.radius + player.hitCircle.radius) {
                this.lastCheckpoint = checkpoint;
                checkpoint.mark(time);
            }

            if (checkpoint.marked) {
                var t = time - checkpoint.markTime;
                var phase = Math.min(1, t * 5);

                checkpoint.activeSprite.alpha = phase;
                checkpoint.inactiveSprite.alpha = 1 - phase;

                if (t < 5)
                    checkpoint.label.alpha = -(Math.pow(t - Math.sqrt(5), 2) + t) / 5 + 1;
                else
                    checkpoint.label.alpha = 0;
            }
        }

        var playerPos = { x: this.player.x, y: this.player.y };
        if (!this.fadeTime && vector.len(playerPos) > this.radius) {
            this.deactivate(time);
        }
    }

    score(s) {
        var ts = Math.floor((vector.len({ x: this.player.x, y: this.player.y }) - 100) / 200 / this.game.scale) + 1;
        ts = Math.max(0, ts);

        if (this.level > 1) {
            var outer = this.parent.outerMaze;
            outer.score((s || 0) + (ts) * Math.pow(10, -this.level + 1) - 1 * Math.pow(10, -this.level + 2));
        } else {
            this.game.score = ts + (s || 0);
        }
    }
}

var game = new Game();
game.load();
game.start();