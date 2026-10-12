document.addEventListener("DOMContentLoaded", () => {
  const classroom = document.getElementById("classroom");
  const subject = classroom?.dataset.subject || "";
  const csrf = document.querySelector('meta[name="csrf-token"]')?.content || "";
  const form = document.getElementById("class-chat-form");
  const input = document.getElementById("class-input");
  const sendButton = document.getElementById("class-send");
  const responseBox = document.getElementById("class-response");
  const modal = document.getElementById("test-modal");
  const testContent = document.getElementById("test-content");
  const testTitle = document.getElementById("test-title");
  const openTestButton = document.getElementById("open-test");

  if (!classroom || !form || !input || !sendButton || !responseBox || !modal || !testContent) return;

  async function askTutor(question) {
    const text = question.trim();
    if (!text || sendButton.disabled) return;
    input.value = "";
    sendButton.disabled = true;
    sendButton.textContent = "Analizando…";
    responseBox.textContent = "Kady está revisando el material de la clase…";
    try {
      const payload = new FormData();
      payload.append("consulta", text);
      payload.append("materia", subject);
      const response = await fetch("/consulta_clase", {
        method: "POST",
        body: payload,
        credentials: "same-origin",
        headers: { "X-CSRF-Token": csrf },
      });
      const data = await response.json().catch(() => ({}));
      responseBox.textContent = response.ok
        ? data.mensaje || "No recibí una respuesta."
        : data.error || "No fue posible consultar el material.";
    } catch (_) {
      responseBox.textContent = "No se pudo conectar con el servidor.";
    } finally {
      sendButton.disabled = false;
      sendButton.textContent = "Consultar material";
    }
  }

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    askTutor(input.value);
  });

  document.addEventListener("diagnostic:review", (event) => {
    askTutor(event.detail.prompt);
    responseBox.scrollIntoView({behavior: "smooth", block: "center"});
  });

  document.querySelectorAll("[data-prompt]").forEach((chip) => {
    chip.addEventListener("click", () => askTutor(chip.dataset.prompt || ""));
  });

  function openModal() {
    modal.hidden = false;
    modal.setAttribute("aria-hidden", "false");
    document.body.classList.add("modal-open");
  }

  function closeModal() {
    modal.hidden = true;
    modal.setAttribute("aria-hidden", "true");
    document.body.classList.remove("modal-open");
  }

  document.querySelectorAll("[data-close-test]").forEach((control) => control.addEventListener("click", closeModal));
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !modal.hidden) closeModal();
  });

  function showLoading() {
    testContent.replaceChildren();
    const loading = document.createElement("div");
    loading.className = "test-loading";
    loading.textContent = "Kady está creando cinco preguntas a partir del PDF…";
    testContent.appendChild(loading);
  }

  function renderQuiz(data) {
    testContent.replaceChildren();
    if (testTitle) testTitle.textContent = data.titulo || "Prueba de la clase";
    const questions = Array.isArray(data.preguntas) ? data.preguntas : [];
    let answered = 0;
    let correct = 0;

    questions.forEach((question, index) => {
      const article = document.createElement("article");
      article.className = "test-question";
      const kicker = document.createElement("span");
      kicker.className = "eyebrow";
      kicker.textContent = `Pregunta ${index + 1} de ${questions.length}`;
      const heading = document.createElement("h3");
      heading.textContent = String(question.pregunta || "Pregunta sin texto");
      const options = document.createElement("div");
      options.className = "test-options";
      const explanation = document.createElement("div");
      explanation.className = "test-explanation";
      explanation.hidden = true;

      Object.entries(question.opciones || {}).forEach(([key, value]) => {
        const option = document.createElement("button");
        option.type = "button";
        option.className = "test-option";
        const optionKey = document.createElement("span");
        optionKey.className = "option-key";
        optionKey.textContent = key;
        const optionText = document.createElement("span");
        optionText.textContent = String(value);
        option.append(optionKey, optionText);
        option.addEventListener("click", () => {
          if (article.dataset.answered === "true") return;
          article.dataset.answered = "true";
          answered += 1;
          const isCorrect = key === question.correcta;
          if (isCorrect) correct += 1;
          options.querySelectorAll("button").forEach((candidate) => {
            candidate.disabled = true;
            const candidateKey = candidate.querySelector(".option-key")?.textContent;
            if (candidateKey === question.correcta) candidate.classList.add("correct");
            else if (candidate === option) candidate.classList.add("wrong");
          });
          explanation.hidden = false;
          explanation.textContent = `${isCorrect ? "Correcto. " : `La respuesta correcta es ${question.correcta}. `}${question.explicacion || ""}`;
          if (answered === questions.length) renderSummary(correct, questions.length);
        });
        options.appendChild(option);
      });

      article.append(kicker, heading, options, explanation);
      testContent.appendChild(article);
    });

    if (!questions.length) {
      const error = document.createElement("p");
      error.textContent = "La prueba no contiene preguntas válidas.";
      testContent.appendChild(error);
    }
  }

  function renderSummary(correct, total) {
    const summary = document.createElement("section");
    summary.className = "test-summary";
    const score = document.createElement("div");
    score.className = "score-ring";
    score.textContent = `${correct}/${total}`;
    const heading = document.createElement("h3");
    heading.textContent = correct >= 4 ? "Excelente comprensión" : correct >= 3 ? "Buen avance" : "Conviene repasar";
    const paragraph = document.createElement("p");
    paragraph.className = "muted";
    paragraph.textContent = "Revisa las explicaciones anteriores para consolidar los conceptos.";
    summary.append(score, heading, paragraph);
    testContent.appendChild(summary);
  }

  async function generateTest() {
    openModal();
    showLoading();
    openTestButton.disabled = true;
    try {
      const payload = new FormData();
      payload.append("materia", subject);
      const response = await fetch("/generar_test", {
        method: "POST",
        body: payload,
        credentials: "same-origin",
        headers: { "X-CSRF-Token": csrf },
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "No fue posible generar la prueba.");
      renderQuiz(data);
    } catch (error) {
      testContent.replaceChildren();
      const message = document.createElement("p");
      message.className = "test-loading";
      message.textContent = error instanceof Error ? error.message : "No fue posible generar la prueba.";
      testContent.appendChild(message);
    } finally {
      openTestButton.disabled = false;
    }
  }

  openTestButton?.addEventListener("click", generateTest);
});
