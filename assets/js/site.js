
(() => {
  const button = document.querySelector('[data-menu-button]');
  const menu = document.querySelector('[data-mobile-menu]');
  if (button && menu) {
    button.addEventListener('click', () => {
      const open = button.getAttribute('aria-expanded') === 'true';
      button.setAttribute('aria-expanded', String(!open));
      menu.hidden = open;
    });
    menu.addEventListener('click', (event) => {
      if (event.target.closest('a')) {
        button.setAttribute('aria-expanded','false');
        menu.hidden = true;
      }
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && !menu.hidden) {
        button.setAttribute('aria-expanded','false');
        menu.hidden = true;
        button.focus();
      }
    });
  }


  const spotlight = document.querySelector('[data-spotlight]');
  if (spotlight) {
    const slides = Array.from(spotlight.querySelectorAll('[data-spotlight-slide]'));
    const controls = spotlight.querySelector('[data-spotlight-controls]');
    const dotsWrap = spotlight.querySelector('[data-spotlight-dots]');
    const prev = spotlight.querySelector('[data-spotlight-prev]');
    const next = spotlight.querySelector('[data-spotlight-next]');
    let index = 0;
    let timer = null;
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    const render = (newIndex, announce = false) => {
      index = (newIndex + slides.length) % slides.length;
      slides.forEach((slide, i) => {
        const active = i === index;
        slide.hidden = !active;
        slide.classList.toggle('is-active', active);
        slide.setAttribute('aria-hidden', String(!active));
        slide.setAttribute('aria-label', `${i + 1} of ${slides.length}`);
      });
      if (dotsWrap) {
        Array.from(dotsWrap.children).forEach((dot, i) => {
          dot.setAttribute('aria-current', String(i === index));
        });
      }
      if (announce && slides[index]) {
        slides[index].focus?.({preventScroll:true});
      }
    };

    const stop = () => {
      if (timer) window.clearInterval(timer);
      timer = null;
    };

    const start = () => {
      stop();
      if (slides.length > 1 && !reduceMotion) {
        timer = window.setInterval(() => render(index + 1), 8000);
      }
    };

    if (slides.length > 1 && controls && dotsWrap && prev && next) {
      controls.hidden = false;
      slides.forEach((slide, i) => {
        slide.setAttribute('tabindex', '-1');
        const dot = document.createElement('button');
        dot.type = 'button';
        dot.className = 'spotlight-dot';
        dot.setAttribute('aria-label', `Show featured item ${i + 1}`);
        dot.addEventListener('click', () => {
          render(i);
          start();
        });
        dotsWrap.appendChild(dot);
      });

      prev.addEventListener('click', () => {
        render(index - 1);
        start();
      });
      next.addEventListener('click', () => {
        render(index + 1);
        start();
      });

      let touchStartX = null;
      spotlight.addEventListener('touchstart', (event) => {
        touchStartX = event.changedTouches[0]?.clientX ?? null;
      }, {passive:true});
      spotlight.addEventListener('touchend', (event) => {
        if (touchStartX === null) return;
        const endX = event.changedTouches[0]?.clientX ?? touchStartX;
        const delta = endX - touchStartX;
        if (Math.abs(delta) > 55) {
          render(index + (delta < 0 ? 1 : -1));
          start();
        }
        touchStartX = null;
      }, {passive:true});

      spotlight.addEventListener('mouseenter', stop);
      spotlight.addEventListener('mouseleave', start);
      spotlight.addEventListener('focusin', stop);
      spotlight.addEventListener('focusout', (event) => {
        if (!spotlight.contains(event.relatedTarget)) start();
      });

      render(0);
      start();
    } else {
      render(0);
    }
  }


  const panelDialog = document.querySelector('[data-panel-dialog]');
  if (panelDialog) {
    const panelProfiles = Array.from(panelDialog.querySelectorAll('[data-panel-profile]'));
    const closeButton = panelDialog.querySelector('[data-panel-close]');
    let lastPanelTrigger = null;

    document.querySelectorAll('[data-panel-open]').forEach((button) => {
      button.addEventListener('click', () => {
        const key = button.getAttribute('data-panel-open');
        const target = panelProfiles.find((profile) => profile.getAttribute('data-panel-profile') === key);
        if (!target) return;

        panelProfiles.forEach((profile) => {
          profile.hidden = profile !== target;
        });

        lastPanelTrigger = button;
        if (typeof panelDialog.showModal === 'function') {
          panelDialog.showModal();
        } else {
          panelDialog.setAttribute('open', '');
        }
        closeButton?.focus();
      });
    });

    const closePanelDialog = () => {
      if (typeof panelDialog.close === 'function') panelDialog.close();
      else panelDialog.removeAttribute('open');
      lastPanelTrigger?.focus();
    };

    closeButton?.addEventListener('click', closePanelDialog);

    panelDialog.addEventListener('click', (event) => {
      if (event.target === panelDialog) closePanelDialog();
    });

    panelDialog.addEventListener('close', () => {
      panelProfiles.forEach((profile) => profile.hidden = true);
    });
  }



  const v09Dialog = document.querySelector('[data-v09-dialog]');
  if (v09Dialog) {
    const v09Profiles = Array.from(v09Dialog.querySelectorAll('[data-v09-profile]'));
    const v09Close = v09Dialog.querySelector('[data-v09-close]');
    let v09LastTrigger = null;

    document.querySelectorAll('[data-v09-open]').forEach((button) => {
      button.addEventListener('click', () => {
        const key = button.getAttribute('data-v09-open');
        const target = v09Profiles.find((profile) => profile.getAttribute('data-v09-profile') === key);
        if (!target) return;

        v09Profiles.forEach((profile) => {
          profile.hidden = profile !== target;
        });

        v09LastTrigger = button;
        if (typeof v09Dialog.showModal === 'function') {
          v09Dialog.showModal();
        } else {
          v09Dialog.setAttribute('open', '');
        }
        v09Close?.focus();
      });
    });

    const closeV09Dialog = () => {
      if (typeof v09Dialog.close === 'function') v09Dialog.close();
      else v09Dialog.removeAttribute('open');
      v09LastTrigger?.focus();
    };

    v09Close?.addEventListener('click', closeV09Dialog);

    v09Dialog.addEventListener('click', (event) => {
      if (event.target === v09Dialog) closeV09Dialog();
    });

    v09Dialog.addEventListener('close', () => {
      v09Profiles.forEach((profile) => profile.hidden = true);
    });
  }



  const bindV09Dialog = (options) => {
    const dialog = document.querySelector(options.dialogSelector);
    if (!dialog) return;

    const profiles = Array.from(dialog.querySelectorAll(options.profileSelector));
    const closeButton = dialog.querySelector(options.closeSelector);
    let lastTrigger = null;

    document.querySelectorAll(options.triggerSelector).forEach((button) => {
      button.addEventListener('click', () => {
        const key = button.getAttribute(options.triggerAttribute);
        const target = profiles.find((profile) => profile.getAttribute(options.profileAttribute) === key);
        if (!target) return;

        profiles.forEach((profile) => {
          profile.hidden = profile !== target;
        });

        lastTrigger = button;
        if (typeof dialog.showModal === 'function') dialog.showModal();
        else dialog.setAttribute('open', '');
        closeButton?.focus();
      });
    });

    const closeDialog = () => {
      if (typeof dialog.close === 'function') dialog.close();
      else dialog.removeAttribute('open');
      lastTrigger?.focus();
    };

    closeButton?.addEventListener('click', closeDialog);
    dialog.addEventListener('click', (event) => {
      if (event.target === dialog) closeDialog();
    });
    dialog.addEventListener('close', () => {
      profiles.forEach((profile) => {
        profile.hidden = true;
      });
    });
  };

  bindV09Dialog({
    dialogSelector: '[data-v09-district-dialog]',
    triggerSelector: '[data-v09-open-district]',
    triggerAttribute: 'data-v09-open-district',
    profileSelector: '[data-v09-district-profile]',
    profileAttribute: 'data-v09-district-profile',
    closeSelector: '[data-v09-district-close]'
  });

  bindV09Dialog({
    dialogSelector: '[data-v09-system-dialog]',
    triggerSelector: '[data-v09-open-system]',
    triggerAttribute: 'data-v09-open-system',
    profileSelector: '[data-v09-system-profile]',
    profileAttribute: 'data-v09-system-profile',
    closeSelector: '[data-v09-system-close]'
  });



  // Manual media carousels used by AI Geopolitic and Veni Faithful.
  document.querySelectorAll('[data-media-carousel]').forEach((carousel) => {
    const slides = Array.from(carousel.querySelectorAll('[data-media-slide]'));
    const prev = carousel.querySelector('[data-media-prev]');
    const next = carousel.querySelector('[data-media-next]');
    const status = carousel.querySelector('[data-media-status]');
    const indexWrap = carousel.querySelector('[data-media-index]');
    if (!slides.length || !prev || !next) return;

    let index = 0;
    let touchStartX = null;
    const indexButtons = [];

    const render = (newIndex, moveFocus = false) => {
      index = (newIndex + slides.length) % slides.length;
      slides.forEach((slide, i) => {
        const active = i === index;
        slide.hidden = !active;
        slide.setAttribute('aria-hidden', String(!active));
        slide.classList.toggle('is-active', active);
        slide.setAttribute('aria-label', `${i + 1} of ${slides.length}`);
      });
      if (status) status.textContent = `${index + 1} / ${slides.length}`;
      indexButtons.forEach((button, i) => {
        button.setAttribute('aria-current', String(i === index));
      });
      if (moveFocus) {
        slides[index]?.focus?.({ preventScroll: true });
      }
    };

    slides.forEach((slide) => slide.setAttribute('tabindex', '-1'));

    if (indexWrap) {
      slides.forEach((_, i) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'media-carousel-index-button';
        button.textContent = String(i + 1);
        button.setAttribute('aria-label', `Show item ${i + 1} of ${slides.length}`);
        button.addEventListener('click', () => render(i));
        indexWrap.appendChild(button);
        indexButtons.push(button);
      });
    }

    prev.addEventListener('click', () => render(index - 1));
    next.addEventListener('click', () => render(index + 1));

    carousel.addEventListener('keydown', (event) => {
      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        render(index - 1);
      } else if (event.key === 'ArrowRight') {
        event.preventDefault();
        render(index + 1);
      }
    });

    carousel.addEventListener('touchstart', (event) => {
      touchStartX = event.changedTouches[0]?.clientX ?? null;
    }, { passive: true });

    carousel.addEventListener('touchend', (event) => {
      if (touchStartX === null) return;
      const endX = event.changedTouches[0]?.clientX ?? touchStartX;
      const delta = endX - touchStartX;
      if (Math.abs(delta) > 50) render(index + (delta < 0 ? 1 : -1));
      touchStartX = null;
    }, { passive: true });

    render(0);
  });

})();
/* AI archive v1 - recent episode viewer */
(() => {
  const viewer = document.querySelector('[data-ai-recent-viewer]');
  if (!viewer) return;

  const manifestUrl = viewer.getAttribute('data-manifest');
  const choices = Array.from(document.querySelectorAll('[data-ai-episode-choice]'));
  const image = viewer.querySelector('[data-ai-viewer-image]');
  const episodeLabel = viewer.querySelector('[data-ai-viewer-episode]');
  const title = viewer.querySelector('[data-ai-viewer-title]');
  const meta = viewer.querySelector('[data-ai-viewer-meta]');
  const slideLabel = viewer.querySelector('[data-ai-viewer-slide-label]');
  const caption = viewer.querySelector('[data-ai-viewer-caption]');
  const status = viewer.querySelector('[data-ai-viewer-status]');
  const prev = viewer.querySelector('[data-ai-viewer-prev]');
  const next = viewer.querySelector('[data-ai-viewer-next]');
  const indexWrap = viewer.querySelector('[data-ai-viewer-index]');

  let episodes = [];
  let currentEpisode = null;
  let slideIndex = 0;
  let touchStartX = null;

  const pad = (value) => String(value).padStart(2, '0');

  const renderSlide = (newIndex) => {
    if (!currentEpisode) return;
    slideIndex = (newIndex + currentEpisode.slideCount) % currentEpisode.slideCount;
    const slideNumber = slideIndex + 1;
    const src = `${currentEpisode.path}${pad(slideNumber)}.${currentEpisode.extension}`;
    image.src = src;
    image.alt = `AI Geopolitic Episode ${currentEpisode.episode}, slide ${slideNumber} of ${currentEpisode.slideCount}: ${currentEpisode.title}`;
    slideLabel.textContent = `Slide ${slideNumber} / ${currentEpisode.slideCount}`;
    status.textContent = `${slideNumber} / ${currentEpisode.slideCount}`;
    caption.textContent = currentEpisode.title;

    Array.from(indexWrap.children).forEach((button, i) => {
      button.setAttribute('aria-current', String(i === slideIndex));
    });
  };

  const buildSlideIndex = () => {
    indexWrap.innerHTML = '';
    for (let i = 0; i < currentEpisode.slideCount; i += 1) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'media-carousel-index-button';
      button.textContent = String(i + 1);
      button.setAttribute('aria-label', `Show slide ${i + 1} of Episode ${currentEpisode.episode}`);
      button.addEventListener('click', () => renderSlide(i));
      indexWrap.appendChild(button);
    }
  };

  const selectEpisode = (episodeNumber, updateUrl = true) => {
    const episode = episodes.find((item) => String(item.episode) === String(episodeNumber));
    if (!episode) return;

    currentEpisode = episode;
    slideIndex = 0;

    episodeLabel.textContent = `Episode ${episode.episode}`;
    title.textContent = episode.title;
    meta.textContent = `${episode.dateLabel} - ${episode.format}`;

    choices.forEach((button) => {
      button.setAttribute('aria-current', String(button.getAttribute('data-ai-episode-choice') === String(episode.episode)));
    });

    buildSlideIndex();
    renderSlide(0);

    if (updateUrl && window.history?.replaceState) {
      window.history.replaceState(null, '', `#ep${episode.episode}`);
    }
  };

  choices.forEach((button) => {
    button.addEventListener('click', () => {
      selectEpisode(button.getAttribute('data-ai-episode-choice'));
    });
  });

  prev?.addEventListener('click', () => renderSlide(slideIndex - 1));
  next?.addEventListener('click', () => renderSlide(slideIndex + 1));

  viewer.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      renderSlide(slideIndex - 1);
    } else if (event.key === 'ArrowRight') {
      event.preventDefault();
      renderSlide(slideIndex + 1);
    }
  });

  viewer.addEventListener('touchstart', (event) => {
    touchStartX = event.changedTouches[0]?.clientX ?? null;
  }, { passive: true });

  viewer.addEventListener('touchend', (event) => {
    if (touchStartX === null) return;
    const endX = event.changedTouches[0]?.clientX ?? touchStartX;
    const delta = endX - touchStartX;
    if (Math.abs(delta) > 50) renderSlide(slideIndex + (delta < 0 ? 1 : -1));
    touchStartX = null;
  }, { passive: true });

  fetch(manifestUrl)
    .then((response) => {
      if (!response.ok) throw new Error(`Archive manifest returned ${response.status}`);
      return response.json();
    })
    .then((data) => {
      episodes = Array.isArray(data) ? data : [];
      if (!episodes.length) throw new Error('Archive manifest is empty.');

      const hashMatch = window.location.hash.match(/^#ep(\d+)$/i);
      const requested = hashMatch?.[1];
      const initial = episodes.some((item) => String(item.episode) === requested)
        ? requested
        : episodes[0].episode;

      selectEpisode(initial, false);
    })
    .catch((error) => {
      console.error('AI Geopolitic archive viewer:', error);
      title.textContent = 'Recent briefings are temporarily unavailable.';
      meta.textContent = 'Please use Instagram for the latest published briefing.';
    });
})();
/* VENI ACCOUNT NAV STATUS V1 START */
(() => {
  const accountPath = "/account/";

  const getStoredSession = () => {
    try {
      for (let i = 0; i < localStorage.length; i += 1) {
        const key = localStorage.key(i);
        if (!key || !/^sb-.*-auth-token$/.test(key)) continue;

        const raw = localStorage.getItem(key);
        if (!raw) continue;

        const value = JSON.parse(raw);
        if (value && typeof value === "object" &&
            (value.user || value.access_token || value.refresh_token)) {
          return value;
        }
      }
    } catch {}
    return null;
  };

  const closeAllMenus = (except = null) => {
    document.querySelectorAll("[data-account-menu]").forEach((menu) => {
      if (menu === except) return;
      const button = menu.querySelector("[data-account-menu-button]");
      const popover = menu.querySelector("[data-account-menu-popover]");
      if (button) button.setAttribute("aria-expanded", "false");
      if (popover) popover.hidden = true;
    });
  };

  const signOutHref = () => {
    const next = window.location.pathname + window.location.search + window.location.hash;
    return `${accountPath}?signout=1&next=${encodeURIComponent(next)}`;
  };

  const buildMenu = (signedIn) => {
    const wrapper = document.createElement("div");
    wrapper.className = "nav-account-menu";
    wrapper.setAttribute("data-account-menu", "");

    const button = document.createElement("button");
    button.type = "button";
    button.className = "nav-account";
    button.setAttribute("data-account-nav", "");
    button.setAttribute("data-account-menu-button", "");
    button.setAttribute("aria-haspopup", "menu");
    button.setAttribute("aria-expanded", "false");
    button.dataset.signedIn = signedIn ? "true" : "false";

    const dot = document.createElement("span");
    dot.className = "nav-account-dot";
    dot.setAttribute("aria-hidden", "true");

    const label = document.createElement("span");
    label.className = "nav-account-label";
    label.textContent = signedIn ? "My Account" : "Veni Account";

    const chevron = document.createElement("span");
    chevron.className = "nav-account-chevron";
    chevron.setAttribute("aria-hidden", "true");
    chevron.textContent = "v";

    button.append(dot, label, chevron);

    const popover = document.createElement("div");
    popover.className = "nav-account-popover";
    popover.setAttribute("data-account-menu-popover", "");
    popover.setAttribute("role", "menu");
    popover.hidden = true;

    if (signedIn) {
      popover.innerHTML = `
        <a role="menuitem" href="/account/">Account home</a>
        <a role="menuitem" href="/account/library/">My Library</a>
        <a role="menuitem" href="/account/settings/">Settings</a>
        <a role="menuitem" href="${signOutHref()}" data-account-signout>Sign out</a>
      `;
    } else {
      popover.innerHTML = `
        <a role="menuitem" href="/account/sign-in/">Sign in</a>
        <a role="menuitem" href="/account/register/">Create account</a>
      `;
    }

    button.addEventListener("click", (event) => {
      event.stopPropagation();
      const opening = button.getAttribute("aria-expanded") !== "true";
      closeAllMenus(wrapper);
      button.setAttribute("aria-expanded", String(opening));
      popover.hidden = !opening;
    });

    wrapper.append(button, popover);
    return wrapper;
  };

  const findInsertTarget = (container) => {
    const cta = container.querySelector(".nav-cta");
    if (cta) return cta;

    const links = Array.from(container.querySelectorAll(":scope > a"));
    const publishing = links.find((link) => link.textContent.trim() === "Veni Publishing");
    if (publishing) return publishing;

    const contact = links.find((link) => link.textContent.trim() === "Contact");
    if (contact) return contact;

    return links.length ? links[links.length - 1] : null;
  };

  const removeLegacyAccountLinks = (container) => {
    container.querySelectorAll(":scope > .nav-account, :scope > [data-account-nav], :scope > .nav-account-menu")
      .forEach((node) => node.remove());
  };

  const installMenu = (container, signedIn) => {
    removeLegacyAccountLinks(container);
    const menu = buildMenu(signedIn);
    const target = findInsertTarget(container);
    container.insertBefore(menu, target);
  };

  const installFooterLink = () => {
    document.querySelectorAll(".footer-col").forEach((column) => {
      const heading = column.querySelector("h3");
      if (!heading || heading.textContent.trim() !== "Publishing house") return;
      if (column.querySelector("[data-account-footer]")) return;

      const link = document.createElement("a");
      link.href = accountPath;
      link.textContent = "Veni Account";
      link.setAttribute("data-account-footer", "");

      const contact = Array.from(column.querySelectorAll("a")).find(
        (item) => item.textContent.trim() === "Contact"
      );
      column.insertBefore(link, contact || null);
    });
  };

  const syncAccountNav = (forcedSignedIn = null) => {
    const signedIn = forcedSignedIn === null ? !!getStoredSession() : !!forcedSignedIn;

    document.querySelectorAll(".desktop-nav").forEach((nav) => {
      installMenu(nav, signedIn);
    });

    document.querySelectorAll(".mobile-menu .container").forEach((nav) => {
      installMenu(nav, signedIn);
    });

    installFooterLink();
  };

  window.syncVeniAccountNav = syncAccountNav;

  syncAccountNav();

  document.addEventListener("click", () => closeAllMenus());
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeAllMenus();
  });
  window.addEventListener("storage", () => syncAccountNav());
})();
/* VENI ACCOUNT NAV STATUS V1 END */
