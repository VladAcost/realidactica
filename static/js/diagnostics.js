(() => {
  "use strict";
  const node = (tag, text, className) => {
    const element = document.createElement(tag);
    if (text !== undefined) element.textContent = text;
    if (className) element.className = className;
    return element;
  };
  const button = (text, action, className = "btn btn-secondary") => {
    const element = node("button", text, className);
    element.type = "button";
    element.addEventListener("click", action);
    return element;
  };
  function renderSummary(container, result, onReview) {
    container.replaceChildren();
    const heading = node("div", undefined, "diagnostic-result-heading");
    const score = node("span", `${result.aciertos}/${result.total}`, "score-ring");
    const description = node("div");
    description.append(node("span", "Tu punto de partida", "eyebrow"), node("h3", result.nivel),
      node("p", "Resultado orientativo de estas preguntas. No es una calificación ni una certificación.", "muted"));
    if (result.materia === "ingles") description.append(node("p", "Evalúa gramática escrita; tu escucha y expresión oral se practican con Kady.", "chat-note"));
    heading.append(score, description);
    container.append(heading);
    const topics = node("div", undefined, "diagnostic-topics");
    [...result.temas].sort((a, b) => a.prioridad - b.prioridad).forEach((topic) => {
      const card = node("article", undefined, "diagnostic-topic");
      card.dataset.priority = topic.prioridad;
      card.append(node("span", `${topic.estado} · ${topic.aciertos}/${topic.total}`, "diagnostic-topic-status"),
        node("h4", topic.nombre), node("p", topic.prioridad === 2 ? "Tienes una buena base en estas preguntas. Sigue practicando para consolidarla." : topic.recomendacion));
      if (result.pdf && topic.paginas.length) {
        const links = node("div", undefined, "diagnostic-page-links");
        topic.paginas.forEach((page) => {
          const link = node("a", `Página ${page}`);
          link.href = `/static/${result.pdf.split("/").map(encodeURIComponent).join("/")}#page=${page}`;
          link.target = "_blank";
          link.rel = "noopener";
          links.append(link);
        });
        card.append(links);
      }
      if (onReview) card.append(button("Repasar con Kady", () => onReview(topic)));
      topics.append(card);
    });
    container.append(topics);
    const review = node("details", undefined, "diagnostic-review");
    review.append(node("summary", "Revisar mis respuestas"));
    result.revision.forEach((item) => {
      const article = node("article", undefined, "diagnostic-review-item");
      article.append(node("h4", `${item.acierto ? "✓" : "↗"} ${item.id}. ${item.pregunta}`),
        node("p", `Tu respuesta: ${item.tu_respuesta}`));
      if (!item.acierto) article.append(node("p", `Respuesta correcta: ${item.respuesta_correcta}`));
      article.append(node("p", item.explicacion, "muted"));
      review.append(article);
    });
    container.append(review);
  }
  window.DiagnosticSummary = {render: renderSummary};

  document.addEventListener("DOMContentLoaded", () => {
    const banner = document.getElementById("course-diagnostic");
    if (!banner) return;
    const subject = banner.dataset.subject;
    const modal = document.getElementById("diagnostic-modal");
    const content = document.getElementById("diagnostic-content");
    const trigger = document.getElementById("open-diagnostic");
    const saved = document.getElementById("diagnostic-saved");
    const status = document.getElementById("diagnostic-status");
    const csrf = document.querySelector('meta[name="csrf-token"]')?.content || "";
    let quiz = null;
    let answers = [];
    let index = 0;
    let sending = false;
    const close = () => {
      if (sending) return;
      modal.hidden = true;
      document.body.classList.remove("modal-open");
      trigger.focus();
    };
    const reviewTopic = (topic) => {
      close();
      document.dispatchEvent(new CustomEvent("diagnostic:review", {detail: {
        prompt: `Quiero repasar ${topic.nombre}. ${topic.recomendacion} Explícalo brevemente con un ejemplo y después hazme una pregunta de práctica.`
      }}));
    };
    function saveView(result) {
      status.textContent = `Nivel orientativo: ${result.nivel} · ${result.aciertos}/${result.total} aciertos`;
      trigger.textContent = "Repetir diagnóstico";
      saved.hidden = false;
      renderSummary(document.getElementById("diagnostic-summary"), result, reviewTopic);
    }
    async function load() {
      const response = await fetch(`/api/diagnosticos/${subject}`, {credentials: "same-origin"});
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "No se pudo cargar el cuestionario.");
      quiz = data;
      answers = Array(quiz.preguntas.length).fill(null);
      if (data.diagnostico) saveView(data.diagnostico);
    }
    async function submit(errorBox, controls) {
      if (sending) return;
      sending = true;
      controls.forEach((control) => {control.disabled = true;});
      const closeButton = modal.querySelector("button[data-close-diagnostic]");
      closeButton.disabled = true;
      errorBox.textContent = "Guardando tu resultado…";
      try {
        const response = await fetch(`/api/diagnosticos/${subject}`, {
          method: "POST", credentials: "same-origin",
          headers: {"Content-Type": "application/json", "X-CSRF-Token": csrf},
          body: JSON.stringify({version: quiz.version, respuestas: answers})
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "No se pudo guardar tu resultado.");
        saveView(data.diagnostico);
        content.replaceChildren();
        renderSummary(content, data.diagnostico, reviewTopic);
        content.append(button("Volver a la clase", close, "btn btn-primary"));
        answers = Array(quiz.preguntas.length).fill(null);
        index = 0;
        focusContent();
      } catch (error) {
        errorBox.textContent = error.message || "No se pudo conectar. Intenta de nuevo.";
        controls.forEach((control) => {control.disabled = false;});
      } finally {
        sending = false;
        closeButton.disabled = false;
      }
    }
    function focusContent() {
      content.tabIndex = -1;
      content.focus();
    }
    function renderQuestion() {
      content.replaceChildren();
      const question = quiz.preguntas[index];
      const progress = node("progress");
      progress.max = quiz.preguntas.length;
      progress.value = index + 1;
      progress.setAttribute("aria-label", "Avance del cuestionario");
      content.append(node("p", `Pregunta ${index + 1} de ${quiz.preguntas.length}`, "eyebrow"), progress,
        node("p", "Responde con lo que recuerdas. Puedes elegir «Aún no lo sé».", "muted"));
      const field = node("fieldset", undefined, "diagnostic-question");
      field.append(node("legend", question.pregunta));
      const options = node("div", undefined, "diagnostic-options");
      const errorBox = node("p", "", "diagnostic-message");
      errorBox.setAttribute("role", "status");
      const actions = node("div", undefined, "diagnostic-actions");
      const back = button("Anterior", () => {index--; renderQuestion();});
      back.disabled = index === 0;
      const next = button(index === quiz.preguntas.length - 1 ? "Ver mi resultado" : "Siguiente", () => {
        if (!answers[index]) return;
        if (index < quiz.preguntas.length - 1) {index++; renderQuestion();}
        else submit(errorBox, [back, next, ...options.querySelectorAll("input")]);
      }, "btn btn-primary");
      next.disabled = !answers[index];
      Object.entries({...question.opciones, "?": "Aún no lo sé"}).forEach(([key, value]) => {
        const label = node("label");
        const input = node("input");
        input.type = "radio";
        input.name = "diagnostic-answer";
        input.value = key;
        input.checked = answers[index] === key;
        input.addEventListener("change", () => {answers[index] = key; next.disabled = false;});
        label.append(input, node("span", value));
        options.append(label);
      });
      field.append(options);
      actions.append(back, next);
      content.append(field, actions, errorBox);
      focusContent();
    }
    trigger.addEventListener("click", async () => {
      modal.hidden = false;
      document.body.classList.add("modal-open");
      if (!quiz) {
        content.replaceChildren(node("p", "Cargando cuestionario…"));
        focusContent();
        try {await load();}
        catch (error) {content.replaceChildren(node("p", error.message)); return;}
      }
      if (!modal.hidden) renderQuestion();
    });
    modal.querySelectorAll("[data-close-diagnostic]").forEach((element) => element.addEventListener("click", close));
    document.addEventListener("keydown", (event) => {
      if (modal.hidden) return;
      if (event.key === "Escape") close();
      if (event.key !== "Tab") return;
      const focusable = [...modal.querySelectorAll('button:not(:disabled), input:not(:disabled), a[href], summary')].filter((element) => element.getClientRects().length);
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && (document.activeElement === first || document.activeElement === content)) {event.preventDefault(); last?.focus();}
      else if (!event.shiftKey && (document.activeElement === last || document.activeElement === content)) {event.preventDefault(); first?.focus();}
    });
    trigger.disabled = true;
    load().catch((error) => {status.textContent = error.message;}).finally(() => {trigger.disabled = false;});
  });
})();
