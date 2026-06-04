'use client';

import { useState, useEffect } from 'react';

const ONBOARDING_KEY = 'suisage_onboarding_seen';

const steps = [
  {
    title: 'Welcome to SuiSage',
    description:
      'SuiSage is an AI-powered trading agent that autonomously trades SUI/USDC on DeepBook. Every decision it makes is stored publicly so you can verify its reasoning.',
    icon: '🧠',
  },
  {
    title: 'Deposit & Earn',
    description:
      'Deposit SUI into the shared vault. The AI agent trades with pooled funds, and you earn proportional returns. You can withdraw anytime.',
    icon: '💰',
  },
  {
    title: 'Verify Everything',
    description:
      'Every trade comes with a full reasoning chain stored on Walrus. Click any trade on the Reasoning page to see exactly why the agent made that decision. No black box.',
    icon: '🔍',
  },
];

export function OnboardingModal() {
  const [show, setShow] = useState(false);
  const [step, setStep] = useState(0);

  useEffect(() => {
    const seen = localStorage.getItem(ONBOARDING_KEY);
    if (!seen) {
      setShow(true);
    }
  }, []);

  function handleClose() {
    localStorage.setItem(ONBOARDING_KEY, 'true');
    setShow(false);
  }

  function handleNext() {
    if (step < steps.length - 1) {
      setStep(step + 1);
    } else {
      handleClose();
    }
  }

  if (!show) return null;

  const current = steps[step];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-gray-900 border border-gray-800 rounded-2xl max-w-md w-full mx-4 p-8 shadow-2xl">
        {/* Step indicator */}
        <div className="flex justify-center gap-2 mb-6">
          {steps.map((_, i) => (
            <div
              key={i}
              className={`w-2 h-2 rounded-full transition-colors ${
                i === step ? 'bg-sage-400' : 'bg-gray-700'
              }`}
            />
          ))}
        </div>

        {/* Content */}
        <div className="text-center">
          <span className="text-4xl mb-4 block">{current.icon}</span>
          <h2 className="text-xl font-bold mb-3">{current.title}</h2>
          <p className="text-gray-400 text-sm leading-relaxed mb-8">{current.description}</p>
        </div>

        {/* Actions */}
        <div className="flex gap-3">
          <button
            onClick={handleClose}
            className="flex-1 px-4 py-2.5 text-sm text-gray-400 hover:text-white border border-gray-700 hover:border-gray-600 rounded-lg transition-colors"
          >
            Skip
          </button>
          <button
            onClick={handleNext}
            className="flex-1 px-4 py-2.5 text-sm font-medium bg-sage-600 hover:bg-sage-700 rounded-lg transition-colors"
          >
            {step < steps.length - 1 ? 'Next' : 'Get Started'}
          </button>
        </div>
      </div>
    </div>
  );
}
