/**
 * Advanced Framer Motion Animation Examples
 * Real-world use cases and premium implementations
 */

import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  CharacterReveal,
  WordRevealBlur,
  TypewriterEffect,
  BounceInText,
  GradientTextAnimation,
  ShimmerText,
  StaggerContainer,
  GridStagger,
  AnimatedButton,
  ExpandableCard,
  Modal,
  ToastContainer,
} from './FramerMotionComponents';

// ============================================================================
// EXAMPLE 1: Premium Landing Page Hero
// ============================================================================

export const HeroSection = () => {
  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', padding: '40px' }}>
      <motion.div
        initial={{ opacity: 0, y: -50 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.8 }}
        style={{
          textAlign: 'center',
          marginBottom: '30px',
        }}
      >
        <h1 style={{ fontSize: '56px', fontWeight: 'bold', marginBottom: '20px' }}>
          <CharacterReveal text="Welcome to Premium Animations" staggerDelay={0.03} />
        </h1>
      </motion.div>

      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 1.5, duration: 0.8 }}
        style={{
          fontSize: '28px',
          marginBottom: '40px',
          maxWidth: '600px',
          lineHeight: '1.6',
        }}
      >
        <WordRevealBlur text="Create stunning, interactive text animations with Framer Motion. No complex setup required." />
      </motion.div>

      <motion.div
        initial={{ scale: 0 }}
        animate={{ scale: 1 }}
        transition={{ delay: 3, type: 'spring', stiffness: 260, damping: 20 }}
      >
        <AnimatedButton variant="primary">
          Get Started
        </AnimatedButton>
      </motion.div>

      <motion.div
        animate={{
          y: [0, -20, 0],
        }}
        transition={{
          duration: 2,
          repeat: Infinity,
          ease: 'easeInOut',
        }}
        style={{
          marginTop: '60px',
          fontSize: '40px',
        }}
      >
        ↓
      </motion.div>
    </div>
  );
};

// ============================================================================
// EXAMPLE 2: Feature Cards with Stagger
// ============================================================================

interface Feature {
  icon: string;
  title: string;
  description: string;
}

const features: Feature[] = [
  {
    icon: '✨',
    title: 'Smooth Animations',
    description: 'Professional, smooth animations that feel natural and responsive',
  },
  {
    icon: '🎯',
    title: 'Precise Control',
    description: 'Fine-grained control over timing, easing, and physics parameters',
  },
  {
    icon: '⚡',
    title: 'Performance',
    description: 'Optimized animations that run at 60fps on all modern devices',
  },
  {
    icon: '🎨',
    title: 'Customizable',
    description: 'Fully customizable variants and transition patterns',
  },
  {
    icon: '📱',
    title: 'Responsive',
    description: 'Animations adapt beautifully to all screen sizes',
  },
  {
    icon: '🔧',
    title: 'Easy Integration',
    description: 'Simple API that integrates seamlessly with React',
  },
];

export const FeatureShowcase = () => {
  return (
    <div style={{ padding: '80px 40px', background: '#f9fafb' }}>
      <motion.h2
        initial={{ opacity: 0 }}
        whileInView={{ opacity: 1 }}
        viewport={{ once: true }}
        style={{
          fontSize: '44px',
          fontWeight: 'bold',
          textAlign: 'center',
          marginBottom: '60px',
        }}
      >
        <GradientTextAnimation text="Why Choose Framer Motion?" />
      </motion.h2>

      <GridStagger columns={3} gap={30} staggerDelay={0.1}>
        {features.map((feature, index) => (
          <motion.div
            key={index}
            whileHover={{ y: -10 }}
            style={{
              padding: '30px',
              background: 'white',
              borderRadius: '12px',
              boxShadow: '0 4px 12px rgba(0, 0, 0, 0.08)',
              cursor: 'pointer',
            }}
          >
            <div style={{ fontSize: '48px', marginBottom: '16px' }}>
              {feature.icon}
            </div>
            <h3 style={{ fontSize: '20px', fontWeight: '600', marginBottom: '12px' }}>
              {feature.title}
            </h3>
            <p style={{ color: '#666', lineHeight: '1.6' }}>
              {feature.description}
            </p>
          </motion.div>
        ))}
      </GridStagger>
    </div>
  );
};

// ============================================================================
// EXAMPLE 3: Text Animation Showcase
// ============================================================================

export const TextAnimationShowcase = () => {
  const [selectedAnimation, setSelectedAnimation] = React.useState<string>('character');

  const showcaseText = 'Premium Text Animations';

  const animations = {
    character: <CharacterReveal text={showcaseText} />,
    wordBlur: <WordRevealBlur text={showcaseText} />,
    typewriter: <TypewriterEffect text={showcaseText} speed={0.05} />,
    bounceIn: <BounceInText text={showcaseText} />,
    gradient: <GradientTextAnimation text={showcaseText} />,
    shimmer: <ShimmerText text={showcaseText} />,
  };

  return (
    <div style={{ padding: '80px 40px', textAlign: 'center' }}>
      <h2 style={{ fontSize: '36px', fontWeight: 'bold', marginBottom: '60px' }}>
        Text Animation Examples
      </h2>

      <motion.div
        key={selectedAnimation}
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        transition={{ duration: 0.3 }}
        style={{
          fontSize: '48px',
          fontWeight: 'bold',
          minHeight: '120px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          marginBottom: '60px',
          background: 'linear-gradient(135deg, #f5f7fa 0%, #c3cfe2 100%)',
          borderRadius: '12px',
          padding: '40px',
        }}
      >
        {animations[selectedAnimation as keyof typeof animations]}
      </motion.div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
          gap: '12px',
        }}
      >
        {Object.entries(animations).map(([key, _]) => (
          <motion.button
            key={key}
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            onClick={() => setSelectedAnimation(key)}
            style={{
              padding: '12px',
              borderRadius: '8px',
              border: selectedAnimation === key ? '2px solid #667eea' : '2px solid #e5e7eb',
              background: selectedAnimation === key ? '#667eea' : 'white',
              color: selectedAnimation === key ? 'white' : '#000',
              cursor: 'pointer',
              fontWeight: '600',
              transition: 'all 0.3s ease',
            }}
          >
            {key.charAt(0).toUpperCase() + key.slice(1)}
          </motion.button>
        ))}
      </div>
    </div>
  );
};

// ============================================================================
// EXAMPLE 4: Interactive Pricing Table
// ============================================================================

interface PricingTier {
  name: string;
  price: number;
  features: string[];
  highlighted?: boolean;
}

const pricingTiers: PricingTier[] = [
  {
    name: 'Starter',
    price: 29,
    features: ['Basic animations', 'Email support', 'Limited variants'],
  },
  {
    name: 'Pro',
    price: 79,
    features: [
      'All animations',
      'Priority support',
      'Custom variants',
      'Advanced gestures',
    ],
    highlighted: true,
  },
  {
    name: 'Enterprise',
    price: 199,
    features: [
      'Everything in Pro',
      'Dedicated support',
      'Custom development',
      'SLA guarantee',
    ],
  },
];

export const PricingTable = () => {
  return (
    <div style={{ padding: '80px 40px', background: 'white' }}>
      <h2
        style={{
          fontSize: '44px',
          fontWeight: 'bold',
          textAlign: 'center',
          marginBottom: '60px',
        }}
      >
        Simple, Transparent Pricing
      </h2>

      <StaggerContainer staggerDelay={0.1} delayChildren={0.2}>
        {pricingTiers.map((tier, index) => (
          <motion.div
            key={index}
            whileHover={tier.highlighted ? { y: -20 } : { y: -5 }}
            style={{
              padding: '40px',
              borderRadius: '12px',
              border: tier.highlighted
                ? '2px solid #667eea'
                : '2px solid #e5e7eb',
              background: tier.highlighted ? '#f0f4ff' : 'white',
              textAlign: 'center',
              position: 'relative',
            }}
          >
            {tier.highlighted && (
              <motion.div
                animate={{ rotate: [0, 5, -5, 0] }}
                transition={{ duration: 4, repeat: Infinity }}
                style={{
                  position: 'absolute',
                  top: -12,
                  left: '50%',
                  transform: 'translateX(-50%)',
                  background: '#667eea',
                  color: 'white',
                  padding: '4px 12px',
                  borderRadius: '20px',
                  fontSize: '12px',
                  fontWeight: 'bold',
                }}
              >
                Popular
              </motion.div>
            )}

            <h3 style={{ fontSize: '24px', fontWeight: 'bold', marginBottom: '16px' }}>
              {tier.name}
            </h3>

            <motion.div
              style={{
                fontSize: '48px',
                fontWeight: 'bold',
                color: '#667eea',
                marginBottom: '8px',
              }}
            >
              ${tier.price}
            </motion.div>

            <p style={{ color: '#666', marginBottom: '32px' }}>per month</p>

            <ul
              style={{
                listStyle: 'none',
                padding: 0,
                marginBottom: '32px',
              }}
            >
              {tier.features.map((feature, fIndex) => (
                <motion.li
                  key={fIndex}
                  initial={{ opacity: 0, x: -20 }}
                  whileInView={{ opacity: 1, x: 0 }}
                  viewport={{ once: true }}
                  transition={{ delay: fIndex * 0.1 }}
                  style={{
                    padding: '12px 0',
                    borderBottom: '1px solid #e5e7eb',
                  }}
                >
                  <span style={{ marginRight: '8px' }}>✓</span>
                  {feature}
                </motion.li>
              ))}
            </ul>

            <AnimatedButton variant={tier.highlighted ? 'primary' : 'outline'}>
              Get Started
            </AnimatedButton>
          </motion.div>
        ))}
      </StaggerContainer>
    </div>
  );
};

// ============================================================================
// EXAMPLE 5: FAQ Section with Expandable Items
// ============================================================================

interface FAQItem {
  question: string;
  answer: string;
}

const faqItems: FAQItem[] = [
  {
    question: 'What is Framer Motion?',
    answer:
      'Framer Motion is a production-ready motion library for React that makes creating animations simple and performant.',
  },
  {
    question: 'Is it free to use?',
    answer:
      'Yes, Framer Motion is completely free and open source. It has a MIT license.',
  },
  {
    question: 'Does it work with TypeScript?',
    answer:
      'Absolutely! Framer Motion has full TypeScript support and excellent type definitions.',
  },
  {
    question: 'What about browser support?',
    answer:
      'Framer Motion supports all modern browsers including Chrome, Firefox, Safari, and Edge.',
  },
];

export const FAQSection = () => {
  return (
    <div style={{ padding: '80px 40px', maxWidth: '800px', margin: '0 auto' }}>
      <h2
        style={{
          fontSize: '44px',
          fontWeight: 'bold',
          textAlign: 'center',
          marginBottom: '60px',
        }}
      >
        Frequently Asked Questions
      </h2>

      <StaggerContainer staggerDelay={0.05}>
        {faqItems.map((item, index) => (
          <ExpandableCard key={index} title={item.question}>
            {item.answer}
          </ExpandableCard>
        ))}
      </StaggerContainer>
    </div>
  );
};

// ============================================================================
// EXAMPLE 6: Complete Demo Page
// ============================================================================

export const CompleteDemoPage = () => {
  const [showModal, setShowModal] = React.useState(false);

  return (
    <div style={{ background: '#fff', minHeight: '100vh' }}>
      {/* Hero */}
      <section>
        <HeroSection />
      </section>

      {/* Features */}
      <section>
        <FeatureShowcase />
      </section>

      {/* Text Animations */}
      <section>
        <TextAnimationShowcase />
      </section>

      {/* Pricing */}
      <section>
        <PricingTable />
      </section>

      {/* FAQ */}
      <section style={{ background: '#f9fafb' }}>
        <FAQSection />
      </section>

      {/* CTA Section */}
      <section
        style={{
          padding: '80px 40px',
          background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
          textAlign: 'center',
          color: 'white',
        }}
      >
        <motion.h2
          initial={{ opacity: 0, y: -20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          style={{
            fontSize: '44px',
            fontWeight: 'bold',
            marginBottom: '20px',
          }}
        >
          Ready to Create Amazing Animations?
        </motion.h2>

        <motion.p
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true }}
          transition={{ delay: 0.2 }}
          style={{
            fontSize: '18px',
            marginBottom: '40px',
            maxWidth: '600px',
            margin: '0 auto 40px',
          }}
        >
          Start building premium animated experiences with Framer Motion today
        </motion.p>

        <motion.button
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          onClick={() => setShowModal(true)}
          style={{
            padding: '16px 40px',
            fontSize: '18px',
            fontWeight: 'bold',
            border: 'none',
            borderRadius: '8px',
            background: 'white',
            color: '#667eea',
            cursor: 'pointer',
          }}
        >
          Get Started Free
        </motion.button>
      </section>

      {/* Modal */}
      <Modal
        isOpen={showModal}
        onClose={() => setShowModal(false)}
        title="Get Started"
      >
        <p>Enter your email to get started with premium animations:</p>
        <input
          type="email"
          placeholder="your@email.com"
          style={{
            width: '100%',
            padding: '12px',
            marginBottom: '16px',
            border: '1px solid #e5e7eb',
            borderRadius: '6px',
            fontSize: '16px',
            boxSizing: 'border-box',
          }}
        />
      </Modal>

      {/* Toast Container */}
      <ToastContainer />
    </div>
  );
};

export default {
  HeroSection,
  FeatureShowcase,
  TextAnimationShowcase,
  PricingTable,
  FAQSection,
  CompleteDemoPage,
};
