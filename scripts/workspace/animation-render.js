// Copyright (C) 2026 Jacob Repp; SPDX-License-Identifier: GPL-3.0-or-later
// Runs only inside the isolated, pinned Blockbench review browser.
window.ForgeAnimationRender = {
    setup(settings) {
        Modes.options.animate.select();
        Timeline.pause(); TextureAnimator.stop();
        MediaPreview.renderer.setPixelRatio(1);
        MediaPreview.resize(settings.width, settings.height);
        MediaPreview.loadAnglePreset(settings.camera);
        MediaPreview.controls.update();
        const gl = MediaPreview.renderer.getContext(), debug = gl.getExtension('WEBGL_debug_renderer_info');
        return {
            browser: navigator.userAgent,
            renderer: gl.getParameter(debug ? debug.UNMASKED_RENDERER_WEBGL : gl.RENDERER),
            animations: Animation.all.map(a => ({uuid: a.uuid, name: a.name, length: a.length, loop: a.loop})),
            textures: Texture.all.map(t => ({uuid: t.uuid, frames: t.frameCount, fps: t.fps, renderMode: t.render_mode, interpolate: t.frame_interpolate})),
        };
    },
    frame(uuid, time) {
        const animation = Animation.all.find(a => a.uuid === uuid);
        if (!animation) throw new Error('Unknown animation');
        animation.select();
        Animation.all.forEach(a => { a.playing = a === animation; });
        Timeline.setTime(time); Animator.preview(true);
        TextureAnimator.playAnimationFrame(time);
        let url;
        Canvas.withoutGizmos(() => { MediaPreview.render(); url = MediaPreview.canvas.toDataURL('image/png'); });
        return url;
    },
};
