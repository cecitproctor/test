  /* ------------------ Complete JavaScript Script (Batch Questions/Answers from Sheet + Dynamic Rendering) ------------------ */

  // Bootstrap Modal Instances
  const warningModal = new bootstrap.Modal(document.getElementById('warningModal'));
  const confirmModal = new bootstrap.Modal(document.getElementById('confirmModal'));
  const duplicateModal = new bootstrap.Modal(document.getElementById('duplicateModal'));
  const errorModal = new bootstrap.Modal(document.getElementById('errorModal'));

  let confirmOpen = false;
  let confirmCallback = null;

  /* ------------------ Exam Guardrails ------------------ */
  // Block reload/inspect/common shortcuts
  document.addEventListener("keydown", function(e) {
    const k = e.key?.toLowerCase?.() || "";
    if (e.key === "F5" || (e.ctrlKey && k === "r")) { e.preventDefault(); }
    if (e.key === "F12" || (e.ctrlKey && e.shiftKey && (k === "i" || k === "j"))) { e.preventDefault(); }
    if (e.ctrlKey && ["c", "v", "x", "a", "s", "u"].includes(k)) { e.preventDefault(); }
  });
  // Disable right click
  document.addEventListener("contextmenu", e => e.preventDefault());

  /* ------------------ Fullscreen Helpers ------------------ */
  function requestFullscreen() {
    const el = document.documentElement;
    if (el.requestFullscreen) return el.requestFullscreen();
    if (el.mozRequestFullScreen) return el.mozRequestFullScreen();
    if (el.webkitRequestFullscreen) return el.webkitRequestFullscreen();
    if (el.msRequestFullscreen) return el.msRequestFullscreen();
  }

  function inFullscreen() {
    return !!(document.fullscreenElement || document.webkitFullscreenElement ||
              document.mozFullScreenElement || document.msFullscreenElement);
  }

  /* ------------------ Exam State ------------------ */
  let questions = []; // Array of {code, question, answer} objects (dynamic from sheet)
  let answersMap = {}; // {code: answer} for instant lookups
  let userAnswers = [];
  let score = 0;
  let current = 0;
  let timer;
  let remaining = 30; // 30 seconds per question
  let examTimerSeconds = 30;
  let userInfo = { lastName: '', firstName: '', email: '', teacher: '', subject: '', schedule: '', code: '', startTime: '', endTime: '', date: '' };

  // Replace this with your actual Google Apps Script Web App URL
  const ANSWER_API_URL = "https://script.google.com/macros/s/AKfycbxCUNN8lgKfpHlgagG0wHkHTUOtqEC-W4mW0yiyax7tKOoHvKxMsY2zHJGMhPH74ZaA/exec";

  let tabWarnings = 0;
  let isExamActive = false;
  let violationLock = false; // prevents duplicate triggers while modal open

  const quizDiv = document.getElementById("quiz");
  const progressEl = document.getElementById("progress");
  const timerEl = document.getElementById("timer");
  const resultEl = document.getElementById("result");
  const startBtn = document.getElementById("startBtn");
  const startCard = document.getElementById("startCard");
  const loadingSpinner = document.getElementById("loadingSpinner");

  /* ------------------ Timer Functions ------------------ */
  function formatTime(s) {
    const m = Math.floor(s / 60).toString().padStart(2, "0");
    const sec = (s % 60).toString().padStart(2, "0");
    return m + ":" + sec;
  }

    function startTimer() {
     clearInterval(timer);
     remaining = examTimerSeconds; // Dynamic from sheet
     updateHud("timer", "Time: " + formatTime(remaining));
     timer = setInterval(() => {
       remaining--;
       updateHud("timer", "Time: " + formatTime(remaining));
       if (remaining <= 0) {
         clearInterval(timer);
         autoSubmitAnswer();
       }
     }, 1000);
   }
   
  function autoSubmitAnswer() {
    const ansInput = document.getElementById("ansInput");
    const ans = ansInput ? ansInput.value.trim() || "-" : "-";
    submitAnswer(ans);
  }

  /* ------------------ HUD Update with Animation ------------------ */
  function updateHud(elementId, text) {
    const el = document.getElementById(elementId);
    if (el) {
      el.textContent = text;
      el.classList.add("updated");
      setTimeout(() => el.classList.remove("updated"), 600);
    }
  }

  /* ------------------ Render Question with Fade-In Animation (Dynamic) ------------------ */
  function renderQuestion(index) {
    quizDiv.innerHTML = "";
    const q = questions[index];
    if (!q) return; // Safety check
    updateHud("progress", `Question ${index + 1}/${questions.length}`);

    const card = document.createElement("div");
    card.className = "card card-custom mx-auto fade-in";
    card.innerHTML = `
      <div class="card-body p-4">
         <div class="question-text">${q.question}</div> <!-- Now preserves whitespace/line breaks via CSS -->
         <input type="text" class="form-control answer-input" id="ansInput" autocomplete="off" autofocus placeholder="Enter answer in CAPS (e.g., B for option b)" style="resize: vertical;"> 
         <button class="btn btn-accent mt-3 w-100" id="submitBtn">Submit</button> 
       </div>
    `;
    quizDiv.appendChild(card);

    // Trigger fade-in animation
    setTimeout(() => card.classList.add("show"), 10);

    startTimer(); // start/reset timer for this question
    if (current === 0) { // Only on first question
       updateHud("timer", `Time: ${formatTime(examTimerSeconds)} per question`);
     }
   

    const submit = () => {
      const ans = document.getElementById("ansInput").value.trim() || "-";
      showConfirmModal(ans, () => submitAnswer(ans));
    };

    document.getElementById("submitBtn").addEventListener("click", submit);
    document.getElementById("ansInput").addEventListener("keydown", e => {
      if (e.key === "Enter") {
        e.preventDefault();
        if (confirmOpen) return; // ignore Enter if confirm is open
        submit();
      }
    });
  }

  /* ------------------ Submit Answer (Instant from Batch Map) ------------------ */
  function submitAnswer(userAnswer) {
    clearInterval(timer); // stop timer on submit

    const q = questions[current];
    if (!q) return;

    const correctAnswer = answersMap[q.code] || ""; // Instant lookup from batch

    userAnswers[current] = userAnswer;

    if (userAnswer.toLowerCase() === correctAnswer.toLowerCase()) {
      score++;
    }

    current++;
    if (current < questions.length) {
      renderQuestion(current);
    } else {
      finishExam();
    }
  }

  /* ------------------ Batch Fetch Questions and Answers from Sheet ------------------ */
   async function fetchAllQuestionsAndAnswers() {
     try {
       const res = await fetch(`${ANSWER_API_URL}?action=getAllQuestionsAndAnswers&code=${encodeURIComponent(userInfo.code)}`);
       if (!res.ok) throw new Error("Network response not ok");
       const response = await res.json(); // { questionsMap, timerSeconds }
       const questionsMap = response.questionsMap || {};
       examTimerSeconds = response.timerSeconds || 30; // Use fetched timer, default 30
       
       if (Object.keys(questionsMap).length === 0) {
         throw new Error("No questions found for this code");
       }

       // Convert map to shuffled array of full question objects
       questions = shuffleArray(Object.values(questionsMap));
       // Build answers map for lookups
       answersMap = Object.fromEntries(questions.map(q => [q.code, q.answer]));
       
       console.log(`Batch loaded: ${questions.length} questions from sheet "${userInfo.code}" with ${examTimerSeconds}s timer`, questionsMap);
       return true;
     } catch (err) {
       console.error("Batch fetch failed:", err);
       return false;
     }
   }
   

  /* ------------------ Confirm Modal (Bootstrap) ------------------ */
  function showConfirmModal(answer, onConfirm) {
    document.getElementById("confirmText").textContent = `Are you sure you want to submit "${answer}" as your final answer?`;
    confirmModal.show();
    confirmOpen = true;
    confirmCallback = onConfirm;

    // Handle keys for modal (capture phase)
    const handleKeys = (e) => {
      if (e.key === "Enter") { e.preventDefault(); handleYes(); }
      if (e.key === "Escape") { e.preventDefault(); handleNo(); }
    };
    document.addEventListener("keydown", handleKeys, true);

    function handleYes() {
      confirmModal.hide();
      confirmOpen = false;
      document.removeEventListener("keydown", handleKeys, true);
      if (confirmCallback) confirmCallback();
    }

    function handleNo() {
      confirmModal.hide();
      confirmOpen = false;
      document.removeEventListener("keydown", handleKeys, true);
    }

    // Event listeners for buttons (remove on hide to avoid duplicates)
    const confirmYesBtn = document.getElementById("confirmYes");
    const confirmNoBtn = document.getElementById("confirmNo");
    confirmYesBtn.onclick = handleYes;
    confirmNoBtn.onclick = handleNo;

    // Clean up on modal hide
    confirmModal._element.addEventListener('hidden.bs.modal', () => {
      confirmOpen = false;
      document.removeEventListener("keydown", handleKeys, true);
      confirmYesBtn.onclick = null;
      confirmNoBtn.onclick = null;
    }, { once: true });
  }

  /* ------------------ Finish Exam & Record Grade (with Fade-In) ------------------ */
  function finishExam() {
    clearInterval(timer);
    isExamActive = false;
    quizDiv.innerHTML = "";
    updateHud("progress", "Exam Completed");
    resultEl.textContent = "Exam Finished";

    const finalScore = `${score}/${questions.length}`;
    const resultsCard = document.createElement("div");
    resultsCard.className = "card card-custom mx-auto fade-in";
    resultsCard.style.maxWidth = "600px";
    resultsCard.innerHTML = `
      <div class="card-body text-center">
        <h2 class="card-title">Exam Results</h2>
        <h3 class="text-primary">Final Score: ${finalScore}</h3>
        <div id="countdownBox" class="mt-3 fs-6 text-muted">
          After 300s, this will go back to the start page.
        </div>
      </div>
    `;
    quizDiv.appendChild(resultsCard);

    // Trigger fade-in
    setTimeout(() => resultsCard.classList.add("show"), 10);

    // Record grade to Google Sheet (all fields)
    userInfo.endTime = new Date().toISOString();
    userInfo.date = new Date().toISOString().split('T')[0];
    const recordUrl = `${ANSWER_API_URL}?action=recordGrade&lastName=${encodeURIComponent(userInfo.lastName)}&firstName=${encodeURIComponent(userInfo.firstName)}&email=${encodeURIComponent(userInfo.email)}&teacher=${encodeURIComponent(userInfo.teacher)}&subject=${encodeURIComponent(userInfo.subject)}&schedule=${encodeURIComponent(userInfo.schedule)}&score=${encodeURIComponent(finalScore)}&startTime=${encodeURIComponent(userInfo.startTime)}&endTime=${encodeURIComponent(userInfo.endTime)}&date=${encodeURIComponent(userInfo.date)}`;

    fetch(recordUrl)
      .then(res => res.json())
      .then(data => {
        if (data.success) {
          console.log("Grade recorded successfully");
        } else {
          console.error("Failed to record grade:", data.error);
        }
      })
      .catch(err => {
        console.error("Failed to record grade:", err);
      });

    // 5-minute countdown to reset
    let countdown = 300;
    const cdEl = document.getElementById("countdownBox");
    const interval = setInterval(() => {
      countdown--;
      cdEl.textContent = `After ${countdown}s, this will go back to the start page.`;
      if (countdown <= 0) {
        clearInterval(interval);
        resetExam();
      }
    }, 1000);
  }

  /* ------------------ Reset Exam (with Fade-Out) ------------------ */
  function resetExam() {
    // Fade out quiz area
    quizDiv.style.opacity = "0";
    quizDiv.style.transition = "opacity 0.5s ease";
    setTimeout(() => {
      quizDiv.innerHTML = "";
      quizDiv.style.opacity = "1";
      resultEl.textContent = "Enter your details to begin the exam.";
      startBtn.style.display = "block";
      startCard.style.display = "block";
      updateHud("progress", "Question 0/0");
      updateHud("timer", "Time: 00:30");
      score = 0;
      current = 0;
      userAnswers = [];
      remaining = 30;
      tabWarnings = 0;
      violationLock = false;
      isExamActive = false;
      questions = [];
      answersMap = {}; // Clear batch data
      examTimerSeconds = 30; 
      document.body.style.background = ""; // Reset if needed
    }, 500);
  }

  /* ------------------ Violation Handling ------------------ */
  function handleViolation() {
    if (!isExamActive || violationLock) return;
    violationLock = true;

    tabWarnings++;

    if (tabWarnings === 1) {
      // First offense: show modal + auto resume after 8s
      document.getElementById("warningText").textContent = "This is your first warning. Resuming exam in 8s...";
      warningModal.show();

      let autoResume = 8;
      const interval = setInterval(() => {
        autoResume--;
        document.getElementById("warningText").textContent = `Resuming exam in ${autoResume}s...`;
        if (autoResume <= 0) {
          clearInterval(interval);
          warningModal.hide();
          requestFullscreen().catch(() => {});
          setTimeout(() => { violationLock = false; }, 150);
        }
      }, 1000);
    } else {
      // Second offense: end exam
      document.body.style.background = "red";
      warningModal.hide();
      finishExam();
      violationLock = false;
    }
  }

  // Visibility change (tab switch / minimize)
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) { handleViolation(); }
  });

  // Exit fullscreen = violation
  document.addEventListener("fullscreenchange", () => {
    if (isExamActive && !inFullscreen()) { handleViolation(); }
  });
  document.addEventListener("webkitfullscreenchange", () => {
    if (isExamActive && !inFullscreen()) { handleViolation(); }
  });
  document.addEventListener("msfullscreenchange", () => {
    if (isExamActive && !inFullscreen()) { handleViolation(); }
  });

   /* ------------------ Modal Event Listeners ------------------ */
  // Warning Modal Buttons
  document.getElementById("continueBtn").addEventListener("click", async () => {
    warningModal.hide();
    try { await requestFullscreen(); } catch (e) {}
    setTimeout(() => { violationLock = false; }, 150);
  });

  document.getElementById("exitBtn").addEventListener("click", () => {
    warningModal.hide();
    finishExam();
    violationLock = false;
  });

  // Duplicate Modal Button
  document.getElementById("duplicateOk").addEventListener("click", () => {
    duplicateModal.hide();
  });

  // Error Modal Button (for invalid code/no questions)
  document.getElementById("errorOk").addEventListener("click", () => {
    errorModal.hide();
    resetExam(); // Reset to form on error
  });

  /* ------------------ Start Exam with Validation + Batch Load + Loading Animation ------------------ */
  startBtn.addEventListener("click", async () => {
    const lastName = document.getElementById("lastName").value.trim();
    const firstName = document.getElementById("firstName").value.trim();
    const email = document.getElementById("email").value.trim();
    const teacher = document.getElementById("teacher").value.trim();
    const subject = document.getElementById("subject").value.trim();
    const schedule = document.getElementById("schedule").value.trim();
    const code = document.getElementById("code").value.trim();

    // Client-side validation (all fields required)
    if (!lastName || !firstName || !email || !teacher || !subject || !schedule || !code) {
      alert("Please fill in all fields.");
      return;
    }
    if (!email.includes("@")) {
      alert("Please enter a valid email.");
      return;
    }
    if (code.length < 3) {
      alert("Test Code must be at least 3 characters (e.g., TEST001).");
      return;
    }
   // Extra dropdown validation
   if (!teacher || teacher === "Select Teacher") {
     alert("Please select a teacher from the dropdown.");
     return;
   }
   if (!schedule || schedule === "Select Schedule") {
     alert("Please select a schedule from the dropdown.");
     return;
   }
   


    // Store user info
    userInfo.lastName = lastName;
    userInfo.firstName = firstName;
    userInfo.email = email;
    userInfo.teacher = teacher;
    userInfo.subject = subject;
    userInfo.schedule = schedule;
    userInfo.code = code.toUpperCase(); // Normalize CODE to uppercase
    userInfo.startTime = new Date().toISOString();
    userInfo.date = new Date().toISOString().split('T')[0];

    // Check for duplicate via Apps Script (based on name only)
    const checkUrl = `${ANSWER_API_URL}?action=checkDuplicate&lastName=${encodeURIComponent(lastName)}&firstName=${encodeURIComponent(firstName)}`;

    try {
      const res = await fetch(checkUrl);
      const data = await res.json();

      if (data.exists) {
        document.getElementById("duplicateText").textContent = `A record for "${firstName} ${lastName}" already exists. Please contact your instructor.`;
        duplicateModal.show();
        return;
      }

      // No duplicate: Proceed to exam
      try { await requestFullscreen(); } catch (e) {}
      startCard.style.display = "none";
      resultEl.textContent = "Exam in progress...";
      isExamActive = true;

      // Show loading spinner
      loadingSpinner.classList.add("show");

      // Batch load questions and answers from sheet (dynamic count)
      const batchSuccess = await fetchAllQuestionsAndAnswers();

      // Hide loading spinner
      loadingSpinner.classList.remove("show");

      if (batchSuccess && questions.length > 0) {
        // Success: Shuffle (already done in fetch), reset state, render first question
        current = 0;
        score = 0;
        userAnswers = [];
        renderQuestion(0);
      } else {
        // Failure: Show error modal (invalid code, no sheet, empty data)
        document.getElementById("errorText").textContent = `Invalid test code "${userInfo.code}" or no questions found. Please contact your instructor.`;
        errorModal.show();
        // Reset state on error
        isExamActive = false;
        startCard.style.display = "block";
        resultEl.textContent = "Enter your details to begin the exam.";
      }
    } catch (err) {
      console.error("Failed to check duplicate or load exam:", err);
      loadingSpinner.classList.remove("show");
      alert("Error loading exam. Please try again.");
      isExamActive = false;
      startCard.style.display = "block";
      resultEl.textContent = "Enter your details to begin the exam.";
    }
  });

  /* ------------------ Utility Functions ------------------ */
  function shuffleArray(arr) {
    // Fisher-Yates shuffle for randomization
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }
