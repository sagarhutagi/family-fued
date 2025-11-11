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
  useEffect(() => {
    // 1. Check for admin status in session
    setIsAdmin(sessionStorage.getItem('is_admin') === 'true');

    // 2. Set up page routing based on URL hash
    const handleHashChange = () => {
      setPage(window.location.hash);
    };
    window.addEventListener('hashchange', handleHashChange);
    handleHashChange(); // Set initial page

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

    // 4. Fetch all editor data (rounds, questions, answers)
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
          round.questions.forEach((question) => {
            question.answers.sort((a, b) => a.display_order - b.display_order);
          });
        });
        setEditorData(rounds as EditorData);
      }
      if (error) console.error('Error fetching editor data:', error);
    };
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
        fetchEditorData
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
      window.removeEventListener('hashchange', handleHashChange);
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
  const [showEditor, setShowEditor] = useState(false);

  const revealedAnswers = useMemo(
    () => JSON.parse(gameState.revealed_answers_json) as string[],
    [gameState.revealed_answers_json]
  );

  const handleSetTeamName = async (team: 'a' | 'b', name: string) => {
    const field = team === 'a' ? 'team_a_name' : 'team_b_name';
    await supabase.from('game_state').update({ [field]: name }).eq('id', 1);
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
              disabled={gameState.strikes >= 3}
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
            <button
              onClick={() => setShowEditor(!showEditor)}
              className="flex-1 px-4 py-2 bg-green-700 rounded-lg hover:bg-green-600 transition-colors"
            >
              {showEditor ? 'Hide Editor' : 'Show Question Editor'}
            </button>
          </div>
        </div>

        {/* Editor (Collapsible) */}
        {showEditor && <EditorComponent editorData={editorData} />}

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

  // --- SOUNDS REMOVED ---
  // const buzzerSfx = useMemo(...)
  // const wrongAnswerSfx = useMemo(...)

  // --- REFINED: Logic to show strike animation (no sound) ---
  const [lastStrikeCount, setLastStrikeCount] = useState(gameState.strikes);

  useEffect(() => {
    if (!gameState) return;

    // --- Strike Animation Logic ---
    // Show animation only when strikes increase
    if (gameState.strikes > lastStrikeCount) {
      // wrongAnswerSfx?.play(); // <-- Sound removed
      setShowStrike(true);
      // Hide the strike animation after a moment
      setTimeout(() => setShowStrike(false), 1500);
    }
    setLastStrikeCount(gameState.strikes); // Update tracker
  }, [gameState, lastStrikeCount]);

  // Split answers into two columns
  const { leftAnswers, rightAnswers } = useMemo(() => {
    if (!currentQuestion) return { leftAnswers: [], rightAnswers: [] };
    
    // Sort answers by display_order
    const sortedAnswers = [...currentQuestion.answers].sort(
      (a, b) => a.display_order - b.display_order
    );
    
    // Split the array.
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

  const handleBuzz = async () => {
    if (!team || gameState.buzzer_state !== 'armed') return;

    // This is an "optimistic" update. We try to update the state
    // only if the buzzer_state is still 'armed'.
    // This prevents two people from buzzing at the same time.
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
            onClick={() => setTeam('a')}
            className="px-12 py-8 bg-indigo-600 text-white text-3xl font-bold rounded-lg shadow-xl hover:bg-indigo-500"
          >
            {gameState.team_a_name}
          </button>
          <button
            onClick={() => setTeam('b')}
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

// --- 6. HOST PAGE SUB-COMPONENTS ---

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

// --- Editor Component with Delete ---
function EditorComponent({ editorData }: { editorData: EditorData }) {
  // --- Form State ---
  const [roundName, setRoundName] = useState('');
  const [qRound, setQRound] = useState('');
  const [qText, setQText] = useState('');
  const [aQuestion, setAQuestion] = useState('');
  const [aText, setAText] = useState('');
  const [aOrder, setAOrder] = useState('1');

  // --- Form Handlers ---
  const handleAddRound = async (e: React.FormEvent) => {
    e.preventDefault();
    await supabase.from('rounds').insert({ name: roundName });
    setRoundName('');
  };

  const handleAddQuestion = async (e: React.FormEvent) => {
    e.preventDefault();
    await supabase
      .from('questions')
      .insert({ round_id: qRound, text: qText });
    setQText('');
  };

  const handleAddAnswer = async (e: React.FormEvent) => {
    e.preventDefault();
    await supabase.from('answers').insert({
      question_id: aQuestion,
      text: aText,
      display_order: parseInt(aOrder, 10),
    });
    setAText('');
    setAOrder((o) => (parseInt(o, 10) + 1).toString());
  };

  // --- Delete Handlers ---
  const handleDeleteRound = async (id: string) => {
    if (window.confirm('Delete this round and all its questions?')) {
      await supabase.from('rounds').delete().eq('id', id);
    }
  };
  const handleDeleteQuestion = async (id: string) => {
    if (window.confirm('Delete this question and all its answers?')) {
      await supabase.from('questions').delete().eq('id', id);
    }
  };
  const handleDeleteAnswer = async (id: string) => {
    if (window.confirm('Delete this answer?')) {
      await supabase.from('answers').delete().eq('id', id);
    }
  };

  return (
    <div className="mb-8 p-6 bg-slate-800 rounded-lg">
      <h3 className="text-xl font-semibold mb-4">Add New Data</h3>
      <div className="grid md:grid-cols-3 gap-6">
        {/* --- Add Round --- */}
        <form onSubmit={handleAddRound} className="space-y-2">
          <h4 className="font-semibold text-lg text-indigo-400">1. Add Round</h4>
          <input
            type="text"
            placeholder="Round Name"
            value={roundName}
            onChange={(e) => setRoundName(e.target.value)}
            className="w-full px-3 py-2 bg-slate-700 rounded-lg border border-slate-600"
            required
          />
          <button
            type="submit"
            className="w-full px-4 py-2 bg-indigo-600 hover:bg-indigo-500 rounded-lg font-semibold"
          >
            Add Round
          </button>
        </form>

        {/* --- Add Question --- */}
        <form onSubmit={handleAddQuestion} className="space-y-2">
          <h4 className="font-semibold text-lg text-indigo-400">2. Add Question</h4>
          <select
            value={qRound}
            onChange={(e) => setQRound(e.target.value)}
            className="w-full px-3 py-2 bg-slate-700 rounded-lg border border-slate-600"
            required
          >
            <option value="" disabled>Select a Round</option>
            {editorData.map((r) => (
              <option key={r.id} value={r.id}>{r.name}</option>
            ))}
          </select>
          <input
            type="text"
            placeholder="Question Text"
            value={qText}
            onChange={(e) => setQText(e.target.value)}
            className="w-full px-3 py-2 bg-slate-700 rounded-lg border border-slate-600"
            required
          />
          <button type="submit" className="w-full px-4 py-2 bg-indigo-600 hover:bg-indigo-500 rounded-lg font-semibold">
            Add Question
          </button>
        </form>

        {/* --- Add Answer --- */}
        <form onSubmit={handleAddAnswer} className="space-y-2">
          <h4 className="font-semibold text-lg text-indigo-400">3. Add Answer</h4>
          <select
            value={aQuestion}
            onChange={(e) => setAQuestion(e.target.value)}
            className="w-full px-3 py-2 bg-slate-700 rounded-lg border border-slate-600"
            required
          >
            <option value="" disabled>Select a Question</option>
            {editorData.flatMap((r) =>
              r.questions.map((q) => (
                <option key={q.id} value={q.id}>{q.text.substring(0, 40)}...</option>
              ))
            )}
          </select>
          <input
            type="text"
            placeholder="Answer Text"
            value={aText}
            onChange={(e) => setAText(e.target.value)}
            className="w-full px-3 py-2 bg-slate-700 rounded-lg border border-slate-600"
            required
          />
          <input
            type="number"
            placeholder="Display Order"
            value={aOrder}
            onChange={(e) => setAOrder(e.target.value)}
            className="w-full px-3 py-2 bg-slate-700 rounded-lg border border-slate-600"
            required
          />
          <button type="submit" className="w-full px-4 py-2 bg-indigo-600 hover:bg-indigo-500 rounded-lg font-semibold">
            Add Answer
          </button>
        </form>
      </div>

      {/* --- Manage Data --- */}
      <h3 className="text-xl font-semibold mt-12 mb-4">Manage Existing Data</h3>
      <div className="space-y-4 max-h-96 overflow-y-auto p-4 bg-slate-900 rounded-lg">
        {editorData.map((round) => (
          <div key={round.id} className="p-3 bg-slate-800 rounded">
            <div className="flex justify-between items-center">
              <span className="text-lg font-bold text-indigo-400">
                {round.name}
              </span>
              <button
                onClick={() => handleDeleteRound(round.id)}
                className="p-1 text-red-500 hover:text-red-400"
              >
                <Trash2 size={18} />
              </button>
            </div>
            <div className="ml-4 mt-2 space-y-2">
              {round.questions.map((q) => (
                <div key={q.id} className="p-2 bg-slate-700 rounded">
                  <div className="flex justify-between items-center">
                    <span className="font-semibold">{q.text}</span>
                    <button
                      onClick={() => handleDeleteQuestion(q.id)}
                      className="p-1 text-red-500 hover:text-red-400"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                  <div className="ml-4 mt-1 space-y-1">
                    {q.answers.map((a) => (
                      <div
                        key={a.id}
                        className="flex justify-between items-center text-sm"
                      >
                        <span className="text-slate-300">
                          (#{a.display_order}) {a.text}
                        </span>
                        <button
                          onClick={() => handleDeleteAnswer(a.id)}
                          className="p-1 text-red-500 hover:text-red-400"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// --- 7. DISPLAY PAGE SUB-COMPONENTS ---

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
      className="card relative w-full h-28 lg:h-36 rounded-lg"
      style={{ transformStyle: 'preserve-3d', transition: 'transform 0.6s' }}
    >
      <AnimatePresence>
        {!isRevealed ? (
          // --- Front Face (Hidden) ---
          <motion.div
            key="front"
            initial={false}
            animate={{ rotateY: 0 }}
            exit={{ rotateY: 90 }}
            transition={{ duration: 0.3 }}
            className="card-face absolute w-full h-full flex items-center justify-center rounded-lg text-6xl lg:text-8xl font-black
                        bg-slate-800 ring-1 ring-slate-700 text-indigo-400"
            style={{ backfaceVisibility: 'hidden' }}
          >
            {order}
          </motion.div>
        ) : (
          // --- Back Face (Revealed) ---
          <motion.div
            key="back"
            initial={{ rotateY: -90 }}
            animate={{ rotateY: 0 }}
            transition={{ duration: 0.3, delay: 0.3 }}
            className="card-face absolute w-full h-full flex items-center justify-between p-4 lg:p-8 rounded-lg
                        bg-slate-700 ring-1 ring-slate-600"
            style={{ backfaceVisibility: 'hidden' }}
          >
            <span className="text-3xl lg:text-4xl font-bold uppercase text-slate-100 truncate pr-4">
              {text}
            </span>
            <span className="text-4xl lg:text-5xl font-black text-amber-400">
              {points}
            </span>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// --- Strike Display Component ---
function StrikeDisplay({ count }: { count: number }) {
  return (
    <div className="flex justify-center items-center gap-4">
      {[1, 2, 3].map((i) => (
        <AnimatePresence key={i}>
          {i <= count && (
            <motion.div
              initial={{ scale: 0, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{
                type: 'spring',
                stiffness: 500,
                damping: 30,
                delay: i * 0.1,
              }}
            >
              <XCircle
                size={64}
                className="text-red-600"
                strokeWidth={1.5}
              />
            </motion.div>
          )}
        </AnimatePresence>
      ))}
    </div>
  );
}