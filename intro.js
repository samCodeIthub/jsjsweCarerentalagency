// weCare intro animation — plays once per browser session on the client page.
(function () {
  try { if (sessionStorage.getItem('wecareIntroSeen')) return; } catch (e) {}
  try { if (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches) return; } catch (e) {}
  try { sessionStorage.setItem('wecareIntroSeen', '1'); } catch (e) {}

  var css = '' +
  '#wcIntro{position:fixed;inset:0;z-index:99999;overflow:hidden;font-family:Poppins,sans-serif;background:radial-gradient(ellipse at 50% 42%,#FFFFFF 0%,#F1F6F4 55%,#E4EEEA 100%)}' +
  '#wcIntro *{box-sizing:border-box;margin:0;padding:0}' +
  '#wcIntro .blob{position:absolute;border-radius:50%;filter:blur(60px);opacity:0}' +
  '#wcIntro #wci-b1{width:520px;height:520px;background:#BFE6DB;left:-120px;top:-140px}' +
  '#wcIntro #wci-b2{width:460px;height:460px;background:#FFD3C6;right:-110px;bottom:-130px}' +
  '#wcIntro #wci-b3{width:380px;height:380px;background:#CDEBE3;right:12%;top:-120px}' +
  '#wcIntro #wci-stage{position:absolute;left:50%;top:50%;width:1200px;height:1000px;margin:-500px 0 0 -600px;transform-origin:50% 50%}' +
  '#wcIntro #wci-lockup{position:absolute;left:100px;top:170px;width:1000px;text-align:center;transform-origin:50% 50%}' +
  '#wcIntro #wci-mark{display:block;margin:0 auto;width:560px;height:418px;overflow:visible}' +
  '#wcIntro #wci-word{margin-top:6px;font-weight:700;font-size:158px;line-height:1.05;letter-spacing:-4px;color:#2C3336;white-space:nowrap}' +
  '#wcIntro #wci-word span{display:inline-block}' +
  '#wcIntro #wci-word .c{color:#0E7A6B}' +
  '#wcIntro #wci-tag{margin-top:14px;font-weight:500;color:#2C3336;white-space:nowrap}' +
  '#wcIntro #wci-tag b{display:block;font-weight:700;font-size:34px;letter-spacing:.34em;color:#0E7A6B;margin-bottom:8px}' +
  '#wcIntro #wci-tag span{display:block;font-size:22px;letter-spacing:.2em}' +
  '#wcIntro #wci-s1{position:absolute;left:0;width:1200px;top:660px;text-align:center;font-weight:600;font-size:80px;letter-spacing:-1px;color:#12332D}' +
  '#wcIntro #wci-u{display:block;width:430px;height:10px;margin:10px auto 0;background:#FF7A59;border-radius:6px;transform-origin:0 50%}' +
  '#wcIntro #wci-s2{position:absolute;left:0;width:1200px;top:748px;text-align:center;font-weight:400;font-size:35px;color:#5C706B}' +
  '#wcIntro #wci-skip{position:fixed;right:18px;bottom:18px;border:1px solid #9FC9BE;background:rgba(255,255,255,.85);color:#0B5D4C;font:600 14px Poppins,sans-serif;padding:9px 18px;border-radius:999px;cursor:pointer}';

  var html = '' +
  '<div class="blob" id="wci-b1"></div><div class="blob" id="wci-b2"></div><div class="blob" id="wci-b3"></div>' +
  '<div id="wci-stage"><div id="wci-lockup">' +
  '<svg id="wci-mark" viewBox="40 70 710 530" aria-label="weCare logo">' +
  '<path id="wci-heart" pathLength="1" fill="none" stroke="#0A7569" stroke-width="44" d="M128 398 C80 335 62 265 92 195 C125 125 215 85 290 130 C325 150 350 170 362 186 C374 170 400 150 435 130 C515 85 605 125 635 195 C655 240 650 290 620 338"/>' +
  '<path id="wci-backRoof" pathLength="1" fill="none" stroke="#3B9A8A" stroke-width="38" stroke-linejoin="miter" d="M445 300 L508 258 L720 432"/>' +
  '<polygon id="wci-backBlock" points="590,372 626,395 598,432 566,408" fill="#0A7569"/>' +
  '<g><rect id="wci-chimney" x="188" y="298" width="52" height="86" fill="#3B9A8A"/>' +
  '<path id="wci-body" d="M150 458 L362 292 L575 458 Q528 540 440 590 L290 590 Q196 540 150 458 Z" fill="#0B7A6C"/>' +
  '<path id="wci-shade" d="M362 296 L192 438 L532 438 Z" fill="#08695E" opacity=".55"/>' +
  '<path id="wci-roof" fill="none" stroke="#3B9A8A" stroke-width="44" stroke-linejoin="miter" d="M108 472 L362 268 L620 474"/>' +
  '<path id="wci-door" d="M300 590 L300 432 Q300 382 364 382 Q428 382 428 432 L428 590 Z" fill="#fff"/>' +
  '<circle id="wci-knob" cx="402" cy="494" r="11" fill="#D9A94B"/></g></svg>' +
  '<div id="wci-word"></div><div id="wci-tag"><b>RENTAL AGENCY</b><span>HOSTELS · APARTMENTS · COMMUNITY</span></div></div>' +
  '<div id="wci-s1">We are here for you.<span id="wci-u"></span></div>' +
  '</div>' +
  '<button id="wci-skip" type="button">Skip intro</button>';

  function start() {
    var link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600;700&display=swap';
    document.head.appendChild(link);
    var st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);
    var root = document.createElement('div'); root.id = 'wcIntro'; root.innerHTML = html;
    document.body.appendChild(root);
    var prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    var $ = function (id) { return document.getElementById('wci-' + id); };
    var clamp = function (x) { return Math.max(0, Math.min(1, x)); };
    var seg = function (t, a, b) { return clamp((t - a) / (b - a)); };
    var easeOut = function (x) { return 1 - Math.pow(1 - x, 3); };
    var easeIO = function (x) { return x < .5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2; };
    var back = function (x) { var c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2); };
    var DURATION = 7.4;

    var word = $('word'), letters = [];
    'weCare'.split('').forEach(function (ch, i) {
      var s = document.createElement('span'); s.textContent = ch; if (i >= 2) s.className = 'c';
      word.appendChild(s); letters.push(s);
    });
    var el = {};
    ['stage','lockup','heart','backRoof','backBlock','chimney','body','shade','roof','door','knob','tag','s1','u','b1','b2','b3'].forEach(function (k) { el[k] = $(k); });
    ['door','chimney','body','roof','shade','knob','backBlock'].forEach(function (k) {
      el[k].style.transformBox = 'fill-box'; el[k].style.transformOrigin = '50% 100%';
    });
    el.knob.style.transformOrigin = '50% 50%'; el.roof.style.transformOrigin = '50% 50%';

    function fit() { el.stage.style.transform = 'scale(' + Math.min(innerWidth / 1200, innerHeight / 1000) + ')'; }
    addEventListener('resize', fit); fit();

    function render(t) {
      var bf = easeOut(seg(t, 0, 1.2));
      el.b1.style.opacity = .55 * bf; el.b2.style.opacity = .5 * bf; el.b3.style.opacity = .4 * bf;
      el.b1.style.transform = 'translate(' + (Math.sin(t * .5) * 30) + 'px,' + (Math.cos(t * .4) * 24) + 'px)';
      el.b2.style.transform = 'translate(' + (Math.cos(t * .45) * 34) + 'px,' + (Math.sin(t * .5) * 26) + 'px)';
      el.b3.style.transform = 'translate(' + (Math.sin(t * .35) * 26) + 'px,' + (Math.cos(t * .3) * 20) + 'px)';
      var h = easeIO(seg(t, .3, 1.55));
      el.heart.style.strokeDasharray = '1 1.02'; el.heart.style.strokeDashoffset = String(1 - h);
      el.heart.style.opacity = seg(t, .3, .45);
      var br = easeOut(seg(t, 1.2, 1.8));
      el.backRoof.style.strokeDasharray = '1 1.02'; el.backRoof.style.strokeDashoffset = String(1 - br);
      el.backBlock.style.opacity = seg(t, 1.7, 1.9);
      var bd = easeOut(seg(t, 1.35, 1.95));
      el.body.style.opacity = bd; el.body.style.transform = 'translateY(' + ((1 - bd) * 40) + 'px)';
      el.shade.style.opacity = .55 * bd; el.shade.style.transform = 'translateY(' + ((1 - bd) * 40) + 'px)';
      var ch = easeOut(seg(t, 1.7, 2.1));
      el.chimney.style.opacity = ch; el.chimney.style.transform = 'translateY(' + ((1 - ch) * 30) + 'px)';
      var rf = back(seg(t, 1.55, 2.15));
      el.roof.style.opacity = seg(t, 1.55, 1.8); el.roof.style.transform = 'translateY(' + ((1 - rf) * -70) + 'px)';
      var dr = back(seg(t, 2.05, 2.6));
      el.door.style.opacity = seg(t, 2.05, 2.25); el.door.style.transform = 'scaleY(' + (0.55 + 0.45 * dr) + ')';
      var kn = back(seg(t, 2.45, 2.85));
      el.knob.style.opacity = seg(t, 2.45, 2.6); el.knob.style.transform = 'scale(' + kn + ')';
      letters.forEach(function (s, i) {
        var p = easeOut(seg(t, 2.55 + i * .07, 3.15 + i * .07));
        s.style.opacity = p; s.style.transform = 'translateY(' + ((1 - p) * 34) + 'px)';
      });
      var tg = easeOut(seg(t, 3.2, 3.9));
      el.tag.style.opacity = tg; el.tag.style.letterSpacing = (.24 + (1 - tg) * .16) + 'em';
      var mv = easeIO(seg(t, 4.4, 5.2));
      el.lockup.style.transform = 'translateY(' + (-205 * mv) + 'px) scale(' + (1 - .36 * mv) + ')';
      var a1 = easeOut(seg(t, 4.9, 5.5));
      el.s1.style.opacity = a1; el.s1.style.transform = 'translateY(' + ((1 - a1) * 28) + 'px)';
      el.u.style.transform = 'scaleX(' + easeOut(seg(t, 5.35, 5.95)) + ')';
      var fo = easeIO(seg(t, 6.85, DURATION));
      el.stage.style.opacity = 1 - fo;
    }

    var t0 = performance.now(), raf, done = false;
    function finish() {
      if (done) return; done = true;
      cancelAnimationFrame(raf);
      root.style.transition = 'opacity .6s ease'; root.style.opacity = '0';
      setTimeout(function () { root.remove(); document.body.style.overflow = prevOverflow; }, 650);
    }
    function loop(now) {
      var t = (now - t0) / 1000;
      render(Math.min(t, DURATION));
      if (t >= DURATION) { finish(); return; }
      raf = requestAnimationFrame(loop);
    }
    raf = requestAnimationFrame(loop);
    document.getElementById('wci-skip').addEventListener('click', finish);
  }
  if (document.body) start(); else document.addEventListener('DOMContentLoaded', start);
})();
