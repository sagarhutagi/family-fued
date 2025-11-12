'use client';

// -------------------------------------------------------------------
// -------------------------------------------------------------------
// -------------------------------------------------------------------
// !! A T T E N T I O N !!
//
// The error you are seeing:
// "Could not resolve '@supabase/supabase-js'"
//
// ...is NOT a code error. It means you have not
// installed the required packages for this project.
//
// To fix this, you MUST run this command in your terminal:
//
// npm install @supabase/supabase-js framer-motion lucide-react
//
// After running the command, RESTART your server.
// The error will go away.
// -------------------------------------------------------------------
// -------------------------------------------------------------------
// -------------------------------------------------------------------

import { createClient } from '@supabase/supabase-js';
import { useState, useEffect, useMemo } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Lock,
  Unlock,
  Shield,
  Monitor,
  Smartphone,
  Copy,
  Plus,
  Trash2,
  List,
  Award,
  ZapOff,
  XCircle,
  Eye,
  ChevronsRight,
  Edit,
  Home,
  FileJson, // <-- New Icon
  Loader2, // <-- New Icon
  Check, // <-- New Icon
} from 'lucide-react';

// --- TYPES (for TypeScript) ---
// These match our Supabase schema
type Round = {
  id: string;
  name: string;
  questions: Question[];
};
type Question = {
  id: string;
  round_id: string;
  text: string;
  answers: Answer[];
};
type Answer = {
  id: string;
  question_id: string;
  text: string;
  display_order: number;
};
type GameState = {
  id: number;
  current_question_id: string | null;
  team_a_score: number;
  team_b_score: number;
  team_a_name: string;
  team_b_name: string;
  revealed_answers_json: string;
  buzzer_state: 'armed' | 'locked';
  buzzer_winner: 'a' | 'b' | null;
  strikes: number;
};
type EditorData = Round[];
type FullQuestion = Question & { answers: Answer[] };

// --- JSON Importer Types ---
type ImportAnswer = {
  text: string;
  order: number;
};
type ImportQuestion = {
  text: string;
  answers: ImportAnswer[];
};
type ImportRound = {
  round_name: string;
  questions: ImportQuestion[];
};

// --- SUPABASE CLIENT SETUP ---
// You MUST create a .env.local file in your project root
// and add your Supabase keys there.
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
// Create one Supabase client for the entire app
const supabase = createClient(supabaseUrl, supabaseAnonKey);

// --- SCORING LOGIC ---
// This is where you define the automatic scores
const POINTS_MAP: { [key: number]: number } = {
  1: 50,
  2: 40,
  3: 30,
  4: 20,
  5: 15,
  6: 10,
  7: 5,
  8: 5,
};
const getPoints = (order: number) => POINTS_MAP[order] || 0;

// --- MAIN APP COMPONENT (Router) ---
export default function App() {
  const [page, setPage] = useState('');
  const [isAdmin, setIsAdmin] = useState(false);
  const [gameState, setGameState] = useState<GameState | null>(null);
  const [editorData, setEditorData] = useState<EditorData>([]);
  const [currentQuestion, setCurrentQuestion] = useState<FullQuestion | null>(
    null
  );

  // --- DATA FETCHING & REALTIME SUBSCRIPTION ---
  const fetchEditorData = async () => {
    const { data: rounds, error } = await supabase.from('rounds').select(`
      id,
      name,
      questions (
        id,
        round_id,
        text,
        answers (
          id,
          question_id,
          text,
          display_order
        )
      )
    `);
    if (rounds) {
      // Sort answers by display_order
      rounds.forEach((round) => {
        round.questions.sort((a, b) => a.text.localeCompare(b.text)); // Sort questions
        round.questions.forEach((question) => {
          question.answers.sort((a, b) => a.display_order - b.display_order);
        });
      });
      setEditorData(rounds as EditorData);
    }
    if (error) console.error('Error fetching editor data:', error);
  };

  useEffect(() => {
    // 1. Check for admin status in session
    // Use try...catch for browser-specific APIs
    try {
      setIsAdmin(sessionStorage.getItem('is_admin') === 'true');
    } catch (e) {
      console.warn('Session storage not available.');
    }

    // 2. Set up page routing based on URL hash
    const handleHashChange = () => {
      // Use try...catch for browser-specific APIs
      try {
        setPage(window.location.hash);
      } catch (e) {
        console.warn('Window location not available.');
      }
    };
    // Add listener only on client
    if (typeof window !== 'undefined') {
      window.addEventListener('hashchange', handleHashChange);
      handleHashChange(); // Set initial page
    }

    // 3. Fetch initial game state
    const fetchGameState = async () => {
      const { data, error } = await supabase
        .from('game_state')
        .select('*')
        .eq('id', 1)
        .single();
      
      if (error) {
         console.error("CRITICAL ERROR: Could not fetch game state.", error);
         // This is likely where the 406 error came from.
         // Running schema.sql again will fix this.
      }
      if (data) setGameState(data as GameState);
    };
    fetchGameState();

    // 4. Fetch initial editor data
    fetchEditorData();

    // 5. --- REALTIME SUBSCRIPTIONS ---
    // Listen for changes to the game state
    const gameStateChannel = supabase
      .channel('game_state_updates')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'game_state', filter: 'id=eq.1' },
        (payload) => {
          setGameState(payload.new as GameState);
        }
      )
      .subscribe();

    // Listen for any changes to rounds, questions, or answers
    // and just refetch all editor data.
    const editorChannel = supabase
      .channel('editor_updates')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'rounds',
        },
        fetchEditorData // Refetch all data on any change
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'questions',
        },
        fetchEditorData
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'answers',
        },
        fetchEditorData
      )
      .subscribe();

    // 6. Cleanup subscriptions on unmount
    return () => {
      if (typeof window !== 'undefined') {
        window.removeEventListener('hashchange', handleHashChange);
      }
      supabase.removeChannel(gameStateChannel);
      supabase.removeChannel(editorChannel);
    };
  }, []);

  // --- DERIVED STATE ---
  // When gameState changes, update the full CurrentQuestion object
  useEffect(() => {
    if (gameState?.current_question_id) {
      for (const round of editorData) {
        const found = round.questions.find(
          (q) => q.id === gameState.current_question_id
        );
        if (found) {
          setCurrentQuestion(found);
          return;
        }
      }
    } else {
      setCurrentQuestion(null);
    }
  }, [gameState, editorData]);

  // --- RENDER LOGIC ---
  const renderPage = () => {
    if (!gameState) {
      return <LoadingScreen message="Connecting to game server..." />;
    }

    switch (page) {
      case '#host':
        if (!isAdmin) {
          window.location.hash = '#login'; // Redirect if not admin
          return null;
        }
        return (
          <HostPage
            gameState={gameState}
            editorData={editorData}
            currentQuestion={currentQuestion}
          />
        );
      case '#display':
        return (
          <DisplayPage
            gameState={gameState}
            currentQuestion={currentQuestion}
          />
        );
      case '#buzzer':
        return <BuzzerPage gameState={gameState} />;
      case '#login':
        return <LoginPage onLogin={() => setIsAdmin(true)} />;
      case '#editor': // <-- New Editor Page
        if (!isAdmin) {
          window.location.hash = '#login';
          return null;
        }
        return <EditorPage editorData={editorData} onImport={fetchEditorData} />;
      default:
        return <LoginPage onLogin={() => setIsAdmin(true)} />;
    }
  };

  return <main className="font-sans">{renderPage()}</main>;
}

// --- 1. LOADING SCREEN ---
function LoadingScreen({ message }: { message: string }) {
  return (
    <div className="h-screen w-screen flex flex-col items-center justify-center bg-slate-900 text-white">
      <div className="animate-spin rounded-full h-16 w-16 border-t-2 border-b-2 border-indigo-400"></div>
      <div className="mt-4 text-2xl font-light">{message}</div>
    </div>
  );
}

// --- 2. LOGIN PAGE ---
function LoginPage({ onLogin }: { onLogin: () => void }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState(false);
  const adminPassword = 'asdfasdf@123'; // Hardcoded password

  const handleLogin = () => {
    if (password === adminPassword) {
      setError(false);
      sessionStorage.setItem('is_admin', 'true'); // Set session flag
      onLogin();
      window.location.hash = '#host'; // Redirect to host panel
    } else {
      setError(true);
      setPassword('');
    }
  };

  return (
    <div className="h-screen w-screen flex items-center justify-center bg-slate-900">
      <div className="w-full max-w-sm p-8 bg-slate-800 rounded-lg shadow-xl">
        <div className="flex justify-center mb-6">
          <Shield size={48} className="text-indigo-400" />
        </div>
        <h1 className="text-3xl font-bold text-center text-white mb-6">
          Admin Login
        </h1>
        {error && (
          <div className="bg-red-800 border border-red-600 text-red-100 px-4 py-2 rounded-lg text-center mb-4">
            Incorrect Password
          </div>
        )}
        <div className="space-y-4">
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleLogin()}
            placeholder="Enter Host Password"
            className="w-full px-4 py-3 bg-slate-700 text-white rounded-lg border border-slate-600 focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
          <button
            onClick={handleLogin}
            className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-indigo-600 text-white font-bold rounded-lg hover:bg-indigo-500 transition-colors"
          >
            <Lock size={18} />
            Access Host Panel
          </button>
        </div>
        <div className="mt-8 text-center text-slate-400">
          <p>
            This is the Family Feud game control panel.
            <br />
            Enter the admin password to continue.
          </p>
        </div>
      </div>
    </div>
  );
}

// --- 3. HOST PAGE ---
function HostPage({
  gameState,
  editorData,
  currentQuestion,
}: {
  gameState: GameState;
  editorData: EditorData;
  currentQuestion: FullQuestion | null;
}) {
  const revealedAnswers = useMemo(
    () => JSON.parse(gameState.revealed_answers_json) as string[],
    [gameState.revealed_answers_json]
  );

  const handleSetTeamName = async (team: 'a' | 'b', name: string) => {
    const field = team === 'a' ? 'team_a_name' : 'team_b_name';
    await supabase.from('game_state').update({ [field]: name }).eq('id', 1);
  };

  // --- NEW: Manual Score Set ---
  const handleSetScore = async (team: 'a' | 'b', score: number) => {
    // Ensure score is a valid number
    const newScore = isNaN(score) ? 0 : score;
    const field = team === 'a' ? 'team_a_score' : 'team_b_score';
    await supabase.from('game_state').update({ [field]: newScore }).eq('id', 1);
  };

  const handleSetQuestion = async (qId: string) => {
    await supabase
      .from('game_state')
      .update({
        current_question_id: qId,
        buzzer_state: 'armed',
        buzzer_winner: null,
        revealed_answers_json: '[]',
        strikes: 0,
      })
      .eq('id', 1);
  };

  const handleResetBuzzers = async () => {
    await supabase
      .from('game_state')
      .update({ buzzer_state: 'armed', buzzer_winner: null })
      .eq('id', 1);
  };

  const handleClearBoard = async () => {
    await supabase
      .from('game_state')
      .update({
        current_question_id: null,
        buzzer_state: 'armed',
        buzzer_winner: null,
        revealed_answers_json: '[]',
        strikes: 0,
      })
      .eq('id', 1);
  };

  const handleResetScores = async () => {
    await supabase
      .from('game_state')
      .update({ team_a_score: 0, team_b_score: 0 })
      .eq('id', 1);
  };

  const handleGiveStrike = async () => {
    const currentStrikes = gameState.strikes || 0;
    if (currentStrikes >= 3) return;

    await supabase
      .from('game_state')
      .update({
        strikes: currentStrikes + 1,
        buzzer_state: 'armed', // Re-arm buzzers
        buzzer_winner: null,
      })
      .eq('id', 1);
  };

  const handleRevealAnswer = async (answer: Answer) => {
    if (revealedAnswers.includes(answer.id) || !gameState.buzzer_winner) return;

    // 1. Calculate points for this answer
    const points = getPoints(answer.display_order);

    // 2. Determine who gets the points
    let newScoreA = gameState.team_a_score;
    let newScoreB = gameState.team_b_score;

    if (gameState.buzzer_winner === 'a') {
      newScoreA += points;
    } else if (gameState.buzzer_winner === 'b') {
      newScoreB += points;
    }

    // 3. Update the database
    await supabase
      .from('game_state')
      .update({
        team_a_score: newScoreA,
        team_b_score: newScoreB,
        revealed_answers_json: JSON.stringify([...revealedAnswers, answer.id]),
        buzzer_state: 'locked', // Keep buzzer locked until host resets
      })
      .eq('id', 1);
  };

  // --- Reveal All Answers ---
  const handleRevealAll = async () => {
    if (!currentQuestion) return;

    // Get all answer IDs for the current question
    const allAnswerIds = currentQuestion.answers.map(a => a.id);
    
    await supabase.from('game_state').update({
      revealed_answers_json: JSON.stringify(allAnswerIds),
      buzzer_state: 'locked', // Lock board when round is over
      buzzer_winner: null,
    }).eq('id', 1);
  };

  // --- Render ---
  return (
    <div className="flex h-screen bg-slate-900 text-white">
      {/* --- Left Sidebar: Questions --- */}
      <aside className="w-1/3 h-screen overflow-y-auto bg-slate-800 p-6 border-r border-slate-700">
        <h1 className="text-3xl font-bold text-white mb-6">Host Panel</h1>
        <div className="space-y-6">
          {editorData.map((round) => (
            <div key={round.id}>
              <h2 className="text-xl font-semibold text-indigo-400 mb-2">
                {round.name}
              </h2>
              <div className="space-y-2">
                {round.questions.map((q) => (
                  <button
                    key={q.id}
                    onClick={() => handleSetQuestion(q.id)}
                    className={`block w-full text-left p-3 rounded-lg transition-colors
                      ${
                        q.id === gameState.current_question_id
                          ? 'bg-indigo-600 text-white'
                          : 'bg-slate-700 hover:bg-slate-600'
                      }`}
                  >
                    {q.text}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </aside>

      {/* --- Main Content: Controls --- */}
      <main className="w-2/3 h-screen overflow-y-auto p-8">
        {/* Scoreboard */}
        <div className="grid grid-cols-3 gap-6 items-center mb-8">
          <ScoreBox
            name={gameState.team_a_name}
            score={gameState.team_a_score}
            color="indigo"
          />
          <BuzzerStatus
            state={gameState.buzzer_state}
            winner={gameState.buzzer_winner}
            teamAName={gameState.team_a_name}
            teamBName={gameState.team_b_name}
            onReset={handleResetBuzzers}
            strikes={gameState.strikes}
          />
          <ScoreBox
            name={gameState.team_b_name}
            score={gameState.team_b_score}
            color="amber"
          />
        </div>

        {/* Links Box */}
        <LinkSharer />

        {/* Global Controls */}
        <div className="mb-8 p-6 bg-slate-800 rounded-lg">
          <h3 className="text-xl font-semibold mb-4">Global Controls</h3>
          <div className="flex gap-4">
            <button
              onClick={handleGiveStrike}
              disabled={gameState.strikes >= 3 || !currentQuestion}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-red-600 rounded-lg hover:bg-red-500 transition-colors disabled:bg-slate-600 disabled:opacity-50"
            >
              <XCircle size={18} />
              Give Strike ({gameState.strikes})
            </button>
            <button
              onClick={handleClearBoard}
              className="flex-1 px-4 py-2 bg-slate-600 rounded-lg hover:bg-slate-500 transition-colors"
            >
              Clear Board
            </button>
            <button
              onClick={handleResetScores}
              className="flex-1 px-4 py-2 bg-red-800 rounded-lg hover:bg-red-700 transition-colors"
            >
              Reset All Scores
            </button>
            <a
              href="/#editor"
              target="_blank"
              className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-green-700 rounded-lg hover:bg-green-600 transition-colors"
            >
              <Edit size={18} /> Open Editor
            </a>
          </div>
        </div>

        {/* Current Question Board */}
        <div className="mt-8 p-6 bg-slate-800 rounded-lg">
          <h2 className="text-2xl font-bold text-center mb-6">
            {currentQuestion?.text || 'No Question Selected'}
          </h2>
          <div className="space-y-3">
            {currentQuestion?.answers.map((answer) => {
              const isRevealed = revealedAnswers.includes(answer.id);
              const points = getPoints(answer.display_order);
              const canReveal =
                !isRevealed && gameState.buzzer_winner !== null;
              return (
                <div
                  key={answer.id}
                  className={`flex items-center justify-between p-4 rounded-lg
                    ${isRevealed ? 'bg-slate-600' : 'bg-slate-700'}`}
                >
                  <div>
                    <span
                      className={`font-mono px-2 py-1 rounded ${
                        isRevealed ? 'bg-slate-500' : 'bg-slate-600'
                      }`}
                    >
                      #{answer.display_order}
                    </span>
                    <span className="ml-4 text-xl">{answer.text}</span>
                  </div>
                  <div className="flex items-center gap-4">
                    <span className="text-2xl font-bold text-amber-400">
                      {points} pts
                    </span>
                    <button
                      onClick={() => handleRevealAnswer(answer)}
                      disabled={!canReveal}
                      className={`px-4 py-2 rounded-lg font-semibold
                        ${
                          canReveal
                            ? 'bg-green-600 hover:bg-green-500'
                            : 'bg-slate-500 opacity-50 cursor-not-allowed'
                        }`}
                    >
                      {isRevealed ? 'Revealed' : 'Reveal'}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
          {/* New Reveal All Button */}
          {currentQuestion && (
             <button
              onClick={handleRevealAll}
              className="w-full mt-4 flex items-center justify-center gap-2 px-4 py-2 bg-indigo-600 rounded-lg hover:bg-indigo-500 transition-colors"
             >
                <Eye size={18} /> Reveal All Answers
             </button>
          )}
        </div>

        {/* Team Name Editor */}
        <div className="mt-8 grid grid-cols-2 gap-6">
          <NameEditor
            name={gameState.team_a_name}
            color="indigo"
            onSave={(name) => handleSetTeamName('a', name)}
          />
          <NameEditor
            name={gameState.team_b_name}
            color="amber"
            onSave={(name) => handleSetTeamName('b', name)}
          />
        </div>
        
        {/* --- NEW: Manual Score Control --- */}
        <div className="mt-8 grid grid-cols-2 gap-6">
          <ManualScoreEditor
            teamName={gameState.team_a_name}
            currentScore={gameState.team_a_score}
            onSetScore={(score) => handleSetScore('a', score)}
            color="indigo"
          />
          <ManualScoreEditor
            teamName={gameState.team_b_name}
            currentScore={gameState.team_b_score}
            onSetScore={(score) => handleSetScore('b', score)}
            color="amber"
          />
        </div>
      </main>
    </div>
  );
}

// --- 4. DISPLAY PAGE ---
function DisplayPage({
  gameState,
  currentQuestion,
}: {
  gameState: GameState;
  currentQuestion: FullQuestion | null;
}) {
  const [showStrike, setShowStrike] = useState(false);
  const revealedAnswers = useMemo(
    () => JSON.parse(gameState.revealed_answers_json) as string[],
    [gameState.revealed_answers_json]
  );
  
  // --- Audio ---
  const scoreSfx = useMemo(() => (
    typeof window !== 'undefined' ? new Audio('/audio/score.wav') : null
  ), []);
  // const wrongSfx = useMemo(() => (
  //   typeof window !== 'undefined' ? new Audio('/audio/wrong.wav') : null
  // ), []);
  
  // --- State for Sound Triggers ---
  const [lastStrikeCount, setLastStrikeCount] = useState(gameState.strikes);
  const [lastRevealedCount, setLastRevealedCount] = useState(revealedAnswers.length);

  useEffect(() => {
    if (!gameState) return;

    // --- Strike Animation & Sound Logic ---
    if (gameState.strikes > lastStrikeCount) {
      // wrongSfx?.play();
      setShowStrike(true);
      setTimeout(() => setShowStrike(false), 1500);
    }
    setLastStrikeCount(gameState.strikes); // Update tracker
    
    // --- Score Sound Logic ---
    const newRevealedCount = revealedAnswers.length;
    if (newRevealedCount > lastRevealedCount) {
      scoreSfx?.play();
    }
    setLastRevealedCount(newRevealedCount);

  }, [gameState, lastStrikeCount, lastRevealedCount, revealedAnswers, scoreSfx]);

  // Split answers into two columns
  const { leftAnswers, rightAnswers } = useMemo(() => {
    if (!currentQuestion) return { leftAnswers: [], rightAnswers: [] };
    
    // Sort answers by display_order
    const sortedAnswers = [...currentQuestion.answers].sort(
      (a, b) => a.display_order - b.display_order
    );
    
    const mid = Math.ceil(sortedAnswers.length / 2);
    return {
      leftAnswers: sortedAnswers.slice(0, mid),
      rightAnswers: sortedAnswers.slice(mid),
    };
  }, [currentQuestion]);

  return (
    <div className="relative h-screen w-screen flex flex-col p-8 lg:p-12 overflow-hidden bg-slate-900 text-slate-100">
      {/* Scoreboard */}
      <div className="flex justify-between items-start mb-8 px-4 gap-6">
        <ScoreBox
          name={gameState.team_a_name}
          score={gameState.team_a_score}
          color="indigo"
          isWinner={gameState.buzzer_winner === 'a'}
          isDisplay={true}
        />
        <StrikeDisplay count={gameState.strikes} />
        <ScoreBox
          name={gameState.team_b_name}
          score={gameState.team_b_score}
          color="amber"
          isWinner={gameState.buzzer_winner === 'b'}
          isDisplay={true}
        />
      </div>

      {/* Question */}
      <div className="w-full text-center mb-10 h-24 flex items-center justify-center">
        <h1 className="text-5xl lg:text-7xl font-extrabold text-white text-shadow-lg">
          {currentQuestion?.text || 'Waiting for question...'}
        </h1>
      </div>

      {/* Two-Column Answer Board */}
      <div
        className="flex-1 flex justify-center gap-6 lg:gap-8"
        style={{ perspective: 1000 }}
      >
        {/* Left Column */}
        <div className="w-1/2 flex flex-col gap-4 lg:gap-6">
          {leftAnswers.map((answer) => (
            <AnswerCard
              key={answer.id}
              order={answer.display_order}
              text={answer.text}
              points={getPoints(answer.display_order)}
              isRevealed={revealedAnswers.includes(answer.id)}
            />
          ))}
        </div>
        {/* Right Column */}
        <div className="w-1/2 flex flex-col gap-4 lg:gap-6">
          {rightAnswers.map((answer) => (
            <AnswerCard
              key={answer.id}
              order={answer.display_order}
              text={answer.text}
              points={getPoints(answer.display_order)}
              isRevealed={revealedAnswers.includes(answer.id)}
            />
          ))}
        </div>
      </div>

      {/* Strike Animation Overlay */}
      <AnimatePresence>
        {showStrike && (
          <motion.div
            initial={{ scale: 0.5, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 2, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 300, damping: 20 }}
            className="absolute inset-0 flex items-center justify-center pointer-events-none"
          >
            <XCircle
              size={500}
              className="text-red-600"
              strokeWidth={1.5}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// --- 5. BUZZER PAGE ---
function BuzzerPage({ gameState }: { gameState: GameState }) {
  const [team, setTeam] = useState<'a' | 'b' | null>(null);

  // --- NEW: Buzzer Sound (Moved here) ---
  const buzzerSfx = useMemo(() => (
    typeof window !== 'undefined' ? new Audio('/audio/buzzer.wav') : null
  ), []);

  useEffect(() => {
    try {
      setTeam(sessionStorage.getItem('buzzer_team') as 'a' | 'b');
    } catch (e) {}
  }, []);

  const handleSetTeam = (t: 'a' | 'b') => {
    try {
      sessionStorage.setItem('buzzer_team', t);
    } catch (e) {}
    setTeam(t);
  };

  const handleBuzz = async () => {
    if (!team || gameState.buzzer_state !== 'armed') return;

    // --- NEW: Play sound immediately ---
    buzzerSfx?.play();

    await supabase
      .from('game_state')
      .update({
        buzzer_state: 'locked',
        buzzer_winner: team,
      })
      .eq('id', 1)
      .eq('buzzer_state', 'armed');
  };

  if (!team) {
    return (
      <div className="h-screen w-screen flex flex-col items-center justify-center gap-8 bg-slate-900">
        <h1 className="text-4xl font-bold text-white text-center">
          Which team are you?
        </h1>
        <div className="flex flex-col sm:flex-row gap-8">
          <button
            onClick={() => handleSetTeam('a')}
            className="px-12 py-8 bg-indigo-600 text-white text-3xl font-bold rounded-lg shadow-xl hover:bg-indigo-500"
          >
            {gameState.team_a_name}
          </button>
          <button
            onClick={() => handleSetTeam('b')}
            className="px-12 py-8 bg-amber-600 text-black text-3xl font-bold rounded-lg shadow-xl hover:bg-amber-500"
          >
            {gameState.team_b_name}
          </button>
        </div>
      </div>
    );
  }

  // --- Buzzer is armed ---
  const isArmed = gameState.buzzer_state === 'armed';
  const isMyTurn = gameState.buzzer_winner === team;
  const isTheirTurn =
    gameState.buzzer_winner !== null && gameState.buzzer_winner !== team;

  const getBuzzerButton = () => {
    let bgColor = 'bg-slate-700';
    let text = 'Locked';
    let isDisabled = true;
    let ringColor = '';

    if (isArmed) {
      bgColor = team === 'a' ? 'bg-indigo-600' : 'bg-amber-600';
      text = 'BUZZ!';
      isDisabled = false;
    } else if (isMyTurn) {
      bgColor = team === 'a' ? 'bg-indigo-500' : 'bg-amber-500';
      text = 'You Buzzed!';
      ringColor = team === 'a' ? 'ring-indigo-400' : 'ring-amber-400';
    } else if (isTheirTurn) {
      bgColor = 'bg-slate-800';
      text = 'They Buzzed!';
    }
    
    const textColor = (team === 'b' && !isDisabled) || (team === 'b' && isMyTurn)
      ? 'text-black' 
      : 'text-white';

    return (
      <button
        onClick={handleBuzz}
        disabled={isDisabled}
        className={`w-full h-full flex items-center justify-center
          text-8xl font-black uppercase rounded-lg shadow-xl
          transition-all duration-150
          focus:outline-none
          active:scale-95
          ${bgColor} ${textColor}
          ${isDisabled ? 'opacity-60 cursor-not-allowed' : 'hover:opacity-90'}
          ${ringColor ? `ring-8 ${ringColor}` : ''}
        `}
      >
        {text}
      </button>
    );
  };

  return (
    <div
      className={`h-screen w-screen p-8 transition-colors ${
        team === 'a' ? 'bg-indigo-900' : 'bg-amber-900'
      }`}
    >
      {getBuzzerButton()}
    </div>
  );
}

// --- 6. NEW EDITOR PAGE ---
function EditorPage({
  editorData,
  onImport
}: {
  editorData: EditorData;
  onImport: () => void;
}) {
  const [selectedRound, setSelectedRound] = useState<Round | null>(null);
  const [selectedQuestion, setSelectedQuestion] = useState<Question | null>(
    null
  );
  const [showImporter, setShowImporter] = useState(false);

  // --- Handlers ---
  const handleSelectRound = (round: Round) => {
    setSelectedRound(round);
    setSelectedQuestion(null); // Clear question selection
  };
  const handleSelectQuestion = (question: Question) => {
    setSelectedQuestion(question);
  };

  const handleDeleteRound = async (id: string) => {
    if (window.confirm('Delete this round and all its questions?')) {
      await supabase.from('rounds').delete().eq('id', id);
      setSelectedRound(null);
      setSelectedQuestion(null);
    }
  };
  const handleDeleteQuestion = async (id: string) => {
    if (window.confirm('Delete this question and all its answers?')) {
      await supabase.from('questions').delete().eq('id', id);
      setSelectedQuestion(null);
      // Note: Editor data will refresh automatically via subscription
    }
  };
  const handleDeleteAnswer = async (id: string) => {
    if (window.confirm('Delete this answer?')) {
      await supabase.from('answers').delete().eq('id', id);
      // Note: Editor data will refresh automatically via subscription
    }
  };

  return (
    <div className="h-screen w-screen flex bg-slate-900 text-white">
      {/* Column 1: Rounds List */}
      <aside className="w-1/3 h-screen overflow-y-auto bg-slate-800 p-6 border-r border-slate-700">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-3xl font-bold text-white">Question Editor</h1>
          <a
            href="/#host"
            className="flex items-center gap-2 px-3 py-2 bg-indigo-600 text-white text-sm font-semibold rounded-lg hover:bg-indigo-500"
          >
            <Home size={16} /> Host Panel
          </a>
        </div>
        
        {/* Import/Add */}
        <div className="flex gap-4 mb-4">
          <button
            onClick={() => setShowImporter(true)}
            className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-blue-600 text-white font-semibold rounded-lg hover:bg-blue-500"
          >
            <FileJson size={18} /> Import from JSON
          </button>
          <AddRoundForm />
        </div>
        
        {/* Rounds List */}
        <div className="space-y-2">
          {editorData.map((round) => (
            <div
              key={round.id}
              className={`p-3 rounded-lg flex items-center justify-between transition-colors ${
                selectedRound?.id === round.id
                  ? 'bg-indigo-600 text-white'
                  : 'bg-slate-700 hover:bg-slate-600'
              }`}
            >
              <button
                onClick={() => handleSelectRound(round)}
                className="flex-1 text-left font-semibold"
              >
                {round.name}
              </button>
              <button
                onClick={() => handleDeleteRound(round.id)}
                className="ml-2 p-1 text-red-400 hover:text-red-300"
              >
                <Trash2 size={16} />
              </button>
            </div>
          ))}
        </div>
      </aside>

      {/* Column 2: Questions / Answers */}
      <main className="w-2/3 h-screen overflow-y-auto p-8">
        {!selectedRound ? (
          <div className="h-full flex items-center justify-center">
            <h2 className="text-2xl text-slate-400">
              Select a round to begin
            </h2>
          </div>
        ) : (
          <div>
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-3xl font-bold">
                Round: {selectedRound.name}
              </h2>
              <AddQuestionForm roundId={selectedRound.id} />
            </div>

            {/* Questions List */}
            <div className="space-y-4">
              {selectedRound.questions.map((q) => (
                <div
                  key={q.id}
                  className={`p-4 rounded-lg ${
                    selectedQuestion?.id === q.id
                      ? 'bg-slate-700'
                      : 'bg-slate-800'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <button
                      onClick={() => handleSelectQuestion(q)}
                      className="text-xl font-semibold text-left flex-1 hover:text-indigo-400"
                    >
                      {q.text}
                    </button>
                    <button
                      onClick={() => handleDeleteQuestion(q.id)}
                      className="ml-2 p-1 text-red-400 hover:text-red-300"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                  
                  {/* Answer Manager (visible when question is selected) */}
                  {selectedQuestion?.id === q.id && (
                    <div className="mt-4 pt-4 border-t border-slate-600">
                      <h4 className="text-lg font-semibold mb-2 text-indigo-400">Manage Answers</h4>
                      <AddAnswerForm questionId={q.id} />
                      <div className="space-y-2 mt-4">
                        {selectedQuestion.answers.map(a => (
                          <div key={a.id} className="flex items-center justify-between p-2 bg-slate-800 rounded">
                            <div>
                              <span className="font-mono bg-slate-600 px-2 py-1 rounded text-sm">#{a.display_order}</span>
                              <span className="ml-3">{a.text}</span>
                            </div>
                            <button
                              onClick={() => handleDeleteAnswer(a.id)}
                              className="p-1 text-red-500 hover:text-red-400"
                            >
                              <Trash2 size={16} />
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </main>

      {/* Importer Modal */}
      {showImporter && <ImporterModal onClose={() => {
        setShowImporter(false);
        onImport(); // Re-fetch data
      }} />}
    </div>
  );
}

// --- 7. HOST PAGE SUB-COMPONENTS ---

function ScoreBox({
  name,
  score,
  color,
  isWinner = false,
  isDisplay = false,
}: {
  name: string;
  score: number;
  color: 'indigo' | 'amber';
  isWinner?: boolean;
  isDisplay?: boolean;
}) {
  const colorClasses = {
    indigo: 'text-indigo-400 ring-indigo-700',
    amber: 'text-amber-400 ring-amber-700',
  };
  const winnerClasses =
    isWinner && color === 'indigo'
      ? 'ring-8 ring-indigo-400 scale-105'
      : isWinner && color === 'amber'
      ? 'ring-8 ring-amber-400 scale-105'
      : 'ring-1';
  
  const sizeClasses = isDisplay
    ? 'p-6 lg:p-8 w-full max-w-md'
    : 'p-6';
  
  const nameSize = isDisplay ? 'text-4xl lg:text-5xl' : 'text-3xl';
  const scoreSize = isDisplay ? 'text-8xl lg:text-9xl' : 'text-8xl';

  return (
    <div
      className={`bg-slate-800 rounded-lg text-center ${colorClasses[color]} ${winnerClasses} ${sizeClasses} transition-all`}
    >
      <h2 className={`${nameSize} font-bold uppercase truncate`}>{name}</h2>
      <div className={`${scoreSize} font-black text-white`}>{score}</div>
    </div>
  );
}

function BuzzerStatus({
  state,
  winner,
  teamAName,
  teamBName,
  onReset,
  strikes,
}: {
  state: 'armed' | 'locked';
  winner: 'a' | 'b' | null;
  teamAName: string;
  teamBName: string;
  onReset: () => void;
  strikes: number;
}) {
  const strikeDisplay = (
    <div className="flex justify-center gap-2 mt-2">
      {[1, 2, 3].map((i) => (
        <XCircle
          key={i}
          size={24}
          className={
            i <= strikes ? 'text-red-500' : 'text-slate-600'
          }
        />
      ))}
    </div>
  );

  if (state === 'armed') {
    return (
      <div className="text-center p-6 bg-green-800 rounded-lg">
        <Unlock size={32} className="mx-auto text-green-300" />
        <h3 className="text-3xl font-bold text-green-200 mt-2">BUZZERS ARMED</h3>
        {strikeDisplay}
      </div>
    );
  }

  // Else, state is 'locked'
  const winnerName = winner === 'a' ? teamAName : teamBName;
  const color = winner === 'a' ? 'indigo' : 'amber';

  return (
    <div
      className={`text-center p-6 bg-slate-800 rounded-lg ring-4 ${
        color === 'indigo' ? 'ring-indigo-500' : 'ring-amber-500'
      }`}
    >
      <Lock size={32} className="mx-auto text-slate-300" />
      <h3
        className={`text-3xl font-bold mt-2 ${
          color === 'indigo' ? 'text-indigo-400' : 'text-amber-400'
        }`}
      >
        {winnerName}
      </h3>
      <p className="text-slate-300">Buzzed in!</p>
      {strikeDisplay}
      <button
        onClick={onReset}
        className="mt-4 w-full flex items-center justify-center gap-2 px-3 py-2 text-sm font-semibold bg-slate-600 hover:bg-slate-500 rounded-lg"
      >
        <ZapOff size={16} />
        Reset Buzzers
      </button>
    </div>
  );
}

function LinkSharer() {
  const [domain, setDomain] = useState('');
  useEffect(() => {
    // Get domain only on client side
    setDomain(window.location.origin);
  }, []);

  const copyToClipboard = (hash: string) => {
    navigator.clipboard.writeText(domain + '/' + hash);
  };

  return (
    <div className="mb-8 p-6 bg-slate-800 rounded-lg">
      <h3 className="text-xl font-semibold mb-4">Share Links</h3>
      <div className="flex gap-4">
        <div className="flex-1 p-4 bg-slate-700 rounded-lg flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Monitor size={20} className="text-slate-300" />
            <span className="font-semibold">Display Screen</span>
          </div>
          <button
            onClick={() => copyToClipboard('#display')}
            className="px-3 py-1 bg-indigo-600 hover:bg-indigo-500 rounded-lg text-sm font-semibold"
          >
            <Copy size={16} />
          </button>
        </div>
        <div className="flex-1 p-4 bg-slate-700 rounded-lg flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Smartphone size={20} className="text-slate-300" />
            <span className="font-semibold">Buzzer App</span>
          </div>
          <button
            onClick={() => copyToClipboard('#buzzer')}
            className="px-3 py-1 bg-indigo-600 hover:bg-indigo-500 rounded-lg text-sm font-semibold"
          >
            <Copy size={16} />
          </button>
        </div>
      </div>
    </div>
  );
}

function NameEditor({
  name,
  color,
  onSave,
}: {
  name: string;
  color: 'indigo' | 'amber';
  onSave: (name: string) => void;
}) {
  const [editingName, setEditingName] = useState(name);
  useEffect(() => {
    setEditingName(name);
  }, [name]);

  return (
    <div className="p-4 bg-slate-800 rounded-lg">
      <h3
        className={`text-lg font-semibold mb-2 ${
          color === 'indigo' ? 'text-indigo-400' : 'text-amber-400'
        }`}
      >
        Edit {name}
      </h3>
      <div className="flex gap-2">
        <input
          type="text"
          value={editingName}
          onChange={(e) => setEditingName(e.target.value)}
          className="flex-1 px-3 py-2 bg-slate-700 text-white rounded-lg border border-slate-600 focus:outline-none focus:ring-2 focus:ring-indigo-500"
        />
        <button
          onClick={() => onSave(editingName)}
          className="px-4 py-2 bg-green-600 hover:bg-green-500 text-white font-semibold rounded-lg"
        >
          Save
        </button>
      </div>
    </div>
  );
}

// --- NEW: Manual Score Editor Component ---
function ManualScoreEditor({
  teamName,
  currentScore,
  onSetScore,
  color,
}: {
  teamName: string;
  currentScore: number;
  onSetScore: (score: number) => void;
  color: 'indigo' | 'amber';
}) {
  const [score, setScore] = useState(currentScore);
  
  // Keep local state in sync with global state
  useEffect(() => {
    setScore(currentScore);
  }, [currentScore]);

  const handleSet = () => {
    onSetScore(Number(score));
  };

  return (
    <div className="p-4 bg-slate-800 rounded-lg">
      <h3
        className={`text-lg font-semibold mb-2 ${
          color === 'indigo' ? 'text-indigo-400' : 'text-amber-400'
        }`}
      >
        Manual Score: {teamName}
      </h3>
      <div className="flex gap-2">
        <input
          type="number"
          value={score}
          onChange={(e) => setScore(Number(e.target.value))}
          className="flex-1 px-3 py-2 bg-slate-700 text-white rounded-lg border border-slate-600 focus:outline-none focus:ring-2 focus:ring-indigo-500"
        />
        <button
          onClick={handleSet}
          className="px-4 py-2 bg-green-600 hover:bg-green-500 text-white font-semibold rounded-lg flex items-center gap-2"
        >
          <Check size={18} /> Set Score
        </button>
      </div>
    </div>
  );
}


// --- 8. EDITOR PAGE SUB-COMPONENTS ---

function AddRoundForm() {
  const [name, setName] = useState('');
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name) return;
    await supabase.from('rounds').insert({ name });
    setName('');
  };
  return (
    <form onSubmit={handleSubmit} className="flex-1 flex gap-2">
      <input
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="New Round Name"
        className="flex-1 px-3 py-2 bg-slate-700 rounded-lg border border-slate-600"
      />
      <button
        type="submit"
        className="p-2 bg-green-600 rounded-lg hover:bg-green-500"
      >
        <Plus size={20} />
      </button>
    </form>
  );
}

function AddQuestionForm({ roundId }: { roundId: string }) {
  const [text, setText] = useState('');
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!text) return;
    await supabase.from('questions').insert({ round_id: roundId, text });
    setText('');
  };
  return (
    <form onSubmit={handleSubmit} className="flex-1 flex gap-2">
      <input
        type="text"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="New Question Text"
        className="flex-1 px-3 py-2 bg-slate-700 rounded-lg border border-slate-600"
      />
      <button
        type="submit"
        className="p-2 bg-green-600 rounded-lg hover:bg-green-500"
      >
        <Plus size={20} />
      </button>
    </form>
  );
}

function AddAnswerForm({ questionId }: { questionId: string }) {
  const [text, setText] = useState('');
  const [order, setOrder] = useState('1');
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!text || !order) return;
    await supabase.from('answers').insert({
      question_id: questionId,
      text,
      display_order: parseInt(order, 10),
    });
    setText('');
    setOrder((o) => (parseInt(o, 10) + 1).toString());
  };
  return (
    <form onSubmit={handleSubmit} className="flex gap-2">
      <input
        type="text"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Answer Text"
        className="flex-1 px-3 py-2 bg-slate-700 rounded-lg border border-slate-600"
      />
      <input
        type="number"
        value={order}
        onChange={(e) => setOrder(e.target.value)}
        placeholder="Order"
        className="w-20 px-3 py-2 bg-slate-700 rounded-lg border border-slate-600"
      />
      <button
        type="submit"
        className="p-2 bg-green-600 rounded-lg hover:bg-green-500"
      >
        <Plus size={20} />
      </button>
    </form>
  );
}

// --- 9. NEW IMPORTER MODAL ---

const jsonExample = `
[
  {
    "round_name": "Survey Says",
    "questions": [
      {
        "text": "Name a popular pizza topping.",
        "answers": [
          { "text": "Pepperoni", "order": 1 },
          { "text": "Mushrooms", "order": 2 },
          { "text": "Onions", "order": 3 }
        ]
      },
      {
        "text": "Name a country in Europe.",
        "answers": [
          { "text": "France", "order": 1 },
          { "text": "Germany", "order": 2 },
          { "text": "Spain", "order": 3 }
        ]
      }
    ]
  }
]
`;

function ImporterModal({ onClose }: { onClose: () => void }) {
  const [jsonText, setJsonText] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [status, setStatus] = useState({ message: '', error: false });

  const handleImport = async () => {
    setIsLoading(true);
    setStatus({ message: 'Parsing JSON...', error: false });

    let data: ImportRound[];
    try {
      data = JSON.parse(jsonText);
      if (!Array.isArray(data)) {
        throw new Error('JSON must be an array of rounds.');
      }
    } catch (e: any) {
      setStatus({ message: `Invalid JSON: ${e.message}`, error: true });
      setIsLoading(false);
      return;
    }

    try {
      for (const round of data) {
        setStatus({ message: `Importing round: ${round.round_name}`, error: false });
        
        // 1. Insert the Round
        const { data: newRound, error: roundError } = await supabase
          .from('rounds')
          .insert({ name: round.round_name })
          .select()
          .single();
        if (roundError) throw new Error(`Failed to create round: ${roundError.message}`);
        
        // 2. Prepare Questions for this Round
        const questionsToInsert = round.questions.map(q => ({
          text: q.text,
          round_id: newRound.id
        }));

        if (questionsToInsert.length === 0) continue;

        // 3. Insert Questions
        const { data: newQuestions, error: qError } = await supabase
          .from('questions')
          .insert(questionsToInsert)
          .select();
        if (qError) throw new Error(`Failed to create questions: ${qError.message}`);

        // 4. Prepare Answers for all new Questions
        const answersToInsert = [];
        for (let i = 0; i < newQuestions.length; i++) {
          const newQuestion = newQuestions[i];
          const originalQuestion = round.questions[i]; // Find by index
          for (const answer of originalQuestion.answers) {
            answersToInsert.push({
              text: answer.text,
              display_order: answer.order,
              question_id: newQuestion.id
            });
          }
        }
        
        // 5. Insert all Answers
        if (answersToInsert.length > 0) {
          const { error: aError } = await supabase.from('answers').insert(answersToInsert);
          if (aError) throw new Error(`Failed to create answers: ${aError.message}`);
        }
      }

      setStatus({ message: 'Import complete! All rounds added.', error: false });
      setIsLoading(false);
      setJsonText('');
      setTimeout(onClose, 1500); // Close modal on success

    } catch (e: any) {
      setStatus({ message: e.message, error: true });
      setIsLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-4xl h-[80vh] bg-slate-800 text-white rounded-lg shadow-xl flex flex-col">
        <div className="flex items-center justify-between p-4 border-b border-slate-700">
          <h2 className="text-2xl font-bold">Import from JSON</h2>
          <button onClick={onClose} className="p-1 text-slate-400 hover:text-white">
            <XCircle size={24} />
          </button>
        </div>

        <div className="flex-1 flex overflow-hidden">
          {/* Left: Format Guide */}
          <aside className="w-1/2 p-6 overflow-y-auto border-r border-slate-700">
            <h3 className="text-lg font-semibold mb-2">Required Format</h3>
            <p className="text-sm text-slate-400 mb-4">
              Your JSON must be an array of rounds, following this structure.
            </p>
            <pre className="p-4 bg-slate-900 text-sm rounded-lg overflow-x-auto">
              <code>{jsonExample}</code>
            </pre>
          </aside>

          {/* Right: Importer */}
          <main className="w-1/2 p-6 flex flex-col">
            <h3 className="text-lg font-semibold mb-2">Paste your JSON here:</h3>
            <textarea
              value={jsonText}
              onChange={(e) => setJsonText(e.target.value)}
              placeholder="[ { ... } ]"
              className="flex-1 w-full p-4 bg-slate-900 text-white rounded-lg border border-slate-700 font-mono text-sm resize-none"
            />
            
            {/* Status & Button */}
            <div className="mt-4 flex items-center gap-4">
              <button
                onClick={handleImport}
                disabled={isLoading}
                className="px-6 py-2 bg-blue-600 text-white font-semibold rounded-lg hover:bg-blue-500 disabled:bg-slate-600 flex items-center gap-2"
              >
                {isLoading ? <Loader2 size={18} className="animate-spin" /> : <FileJson size={18} />}
                {isLoading ? 'Importing...' : 'Parse & Import'}
              </button>
              {status.message && (
                <span className={status.error ? 'text-red-400' : 'text-green-400'}>
                  {status.message}
                </span>
              )}
            </div>
          </main>
        </div>
      </div>
    </div>
  );
}


// --- 10. DISPLAY PAGE SUB-COMPONENTS ---

function AnswerCard({
  order,
  text,
  points,
  isRevealed,
}: {
  order: number;
  text: string;
  points: number;
  isRevealed: boolean;
}) {
  return (
    <div
      className="w-full h-24 lg:h-28 rounded-xl shadow-lg border-4 border-slate-600"
      style={{ transformStyle: 'preserve-3d' }}
    >
      <motion.div
        className="relative w-full h-full"
        initial={false}
        animate={{ rotateY: isRevealed ? 180 : 0 }}
        transition={{ duration: 0.5, type: 'spring' }}
        style={{ transformStyle: 'preserve-3d' }}
      >
        {/* Front (Hidden) */}
        <div
          className="absolute inset-0 w-full h-full bg-indigo-700 rounded-lg flex items-center justify-center p-4"
          style={{ backfaceVisibility: 'hidden' }}
        >
          <span className="text-4xl lg:text-6xl font-black text-indigo-300">
            {order}
          </span>
        </div>

        {/* Back (Revealed) */}
        <div
          className="absolute inset-0 w-full h-full bg-slate-700 rounded-lg flex items-center justify-between p-6"
          style={{ transform: 'rotateY(180deg)', backfaceVisibility: 'hidden' }}
        >
          <span className="text-2xl lg:text-4xl font-semibold uppercase truncate">
            {text}
          </span>
          <span className="text-3xl lg:text-5xl font-bold text-amber-400">
            {points}
          </span>
        </div>
      </motion.div>
    </div>
  );
}

function StrikeDisplay({ count }: { count: number }) {
  return (
    <div className="flex flex-col items-center">
      {[1, 2, 3].map((i) => (
        <motion.div
          key={i}
          animate={{
            scale: i <= count ? 1 : 0.7,
            opacity: i <= count ? 1 : 0.3,
          }}
          transition={{ type: 'spring', stiffness: 400, damping: 20 }}
        >
          <XCircle
            size={64}
            className={
              i <= count
                ? 'text-red-600'
                : 'text-slate-700'
            }
            strokeWidth={1.5}
          />
        </motion.div>
      ))}
    </div>
  );
}