/**
 * Complete Animation Showcase
 * Production-ready example combining all advanced techniques
 *
 * This file demonstrates:
 * - Complex multi-element animations
 * - Custom transitions
 * - Gesture-based interactions
 * - Premium text effects
 * - Performance optimization
 */

import React from 'react';
import { motion, AnimatePresence, useScroll, useTransform, MotionConfig } from 'framer-motion';

// ============================================================================
// 1. PREMIUM LANDING PAGE WITH ALL TECHNIQUES
// ============================================================================

export const CompletePremiumLanding = () => {
  return (
    <MotionConfig reducedMotion="user">
      <div style={{ background: '#fff' }}>
        {/* Navigation */}
        <Navigation />

        {/* Hero Section */}
        <HeroWithAnimations />

        {/* Features Grid */}
        <FeaturesGrid />

        {/* Testimonials Carousel */}
        <TestimonialsCarousel />

        {/* CTA Section */}
        <CTASection />

        {/* Footer */}
        <Footer />
      </div>
    </MotionConfig>
  );
};

// ============================================================================
// COMPONENT: Navigation with Scroll Effect
// ============================================================================

const Navigation = () => {
  const { scrollY } = useScroll();
  const shadowOpacity = useTransform(scrollY, [0, 50], [0, 1]);

  return (
    <motion.nav
      style={{
        position: 'sticky',
        top: 0,
        zIndex: 100,
        background: 'white',
        padding: '16px 40px',
        boxShadow: useTransform(
          shadowOpacity,
          [0, 1],
          [
            '0 0 0 rgba(0,0,0,0)',
            '0 4px 12px rgba(0,0,0,0.1)',
          ]
        ),
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <motion.div
          initial={{ opacity: 0, x: -20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.6 }}
          style={{
            fontSize: '24px',
            fontWeight: 'bold',
            background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
          }}
        >
          VOYO
        </motion.div>

        <div style={{ display: 'flex', gap: '30px' }}>
          {['Features', 'Pricing', 'Contact'].map((item, i) => (
            <motion.a
              key={item}
              href={`#${item.toLowerCase()}`}
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.1, duration: 0.5 }}
              whileHover={{ color: '#667eea', y: -2 }}
              style={{
                cursor: 'pointer',
                textDecoration: 'none',
                color: '#1f2937',
                fontWeight: '500',
                transition: 'all 0.3s ease',
              }}
            >
              {item}
            </motion.a>
          ))}
        </div>
      </div>
    </motion.nav>
  );
};

// ============================================================================
// COMPONENT: Hero Section with Advanced Animations
// ============================================================================

const HeroWithAnimations = () => {
  const containerVariants = {
    hidden: { opacity: 0 },
    visible: {
      opacity: 1,
      transition: {
        staggerChildren: 0.1,
        delayChildren: 0.2,
      },
    },
  };

  const itemVariants = {
    hidden: { opacity: 0, y: 20 },
    visible: {
      opacity: 1,
      y: 0,
      transition: {
        type: 'spring',
        stiffness: 100,
        damping: 12,
      },
    },
  };

  return (
    <section
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '80px 40px',
        background: 'linear-gradient(135deg, #f5f7fa 0%, #c3cfe2 100%)',
      }}
    >
      <motion.div
        variants={containerVariants}
        initial="hidden"
        animate="visible"
        style={{
          textAlign: 'center',
          maxWidth: '800px',
        }}
      >
        {/* Main Title */}
        <motion.h1
          variants={itemVariants}
          style={{
            fontSize: '64px',
            fontWeight: 'bold',
            marginBottom: '20px',
            background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
            lineHeight: '1.2',
          }}
        >
          Elevate Your User Experience
        </motion.h1>

        {/* Subtitle */}
        <motion.p
          variants={itemVariants}
          style={{
            fontSize: '24px',
            color: '#666',
            marginBottom: '40px',
            lineHeight: '1.6',
          }}
        >
          Create stunning, performant animations that captivate your users and drive engagement
        </motion.p>

        {/* CTA Buttons */}
        <motion.div
          variants={itemVariants}
          style={{
            display: 'flex',
            gap: '20px',
            justifyContent: 'center',
            flexWrap: 'wrap',
          }}
        >
          <motion.button
            whileHover={{ scale: 1.05, y: -4 }}
            whileTap={{ scale: 0.95 }}
            transition={{ type: 'spring', stiffness: 400, damping: 17 }}
            style={{
              padding: '16px 40px',
              fontSize: '18px',
              fontWeight: '600',
              border: 'none',
              borderRadius: '8px',
              background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
              color: 'white',
              cursor: 'pointer',
              boxShadow: '0 10px 30px rgba(102, 126, 234, 0.3)',
            }}
          >
            Get Started
          </motion.button>

          <motion.button
            whileHover={{ scale: 1.05, y: -4 }}
            whileTap={{ scale: 0.95 }}
            style={{
              padding: '16px 40px',
              fontSize: '18px',
              fontWeight: '600',
              border: '2px solid #667eea',
              borderRadius: '8px',
              background: 'transparent',
              color: '#667eea',
              cursor: 'pointer',
            }}
          >
            Learn More
          </motion.button>
        </motion.div>

        {/* Floating Elements */}
        <motion.div
          animate={{
            y: [0, -20, 0],
          }}
          transition={{
            duration: 3,
            repeat: Infinity,
            ease: 'easeInOut',
          }}
          style={{
            marginTop: '80px',
            fontSize: '48px',
          }}
        >
          ↓
        </motion.div>
      </motion.div>
    </section>
  );
};

// ============================================================================
// COMPONENT: Features Grid with Stagger
// ============================================================================

interface Feature {
  icon: string;
  title: string;
  description: string;
}

const FeaturesGrid = () => {
  const features: Feature[] = [
    {
      icon: '⚡',
      title: 'Lightning Fast',
      description: 'Optimized animations running at 60fps on all devices',
    },
    {
      icon: '🎨',
      title: 'Highly Customizable',
      description: 'Infinite customization options for your unique style',
    },
    {
      icon: '📱',
      title: 'Responsive Design',
      description: 'Perfect animations on mobile, tablet, and desktop',
    },
    {
      icon: '🔧',
      title: 'Easy Integration',
      description: 'Simple API that works seamlessly with React',
    },
    {
      icon: '♿',
      title: 'Accessible',
      description: 'Respects user preferences for reduced motion',
    },
    {
      icon: '🚀',
      title: 'Production Ready',
      description: 'Battle-tested in production applications',
    },
  ];

  const containerVariants = {
    hidden: { opacity: 0 },
    visible: {
      opacity: 1,
      transition: {
        staggerChildren: 0.08,
      },
    },
  };

  const itemVariants = {
    hidden: { opacity: 0, y: 20 },
    visible: {
      opacity: 1,
      y: 0,
      transition: {
        type: 'spring',
        stiffness: 100,
        damping: 12,
      },
    },
  };

  return (
    <section
      id="features"
      style={{
        padding: '120px 40px',
        background: '#fff',
      }}
    >
      <motion.h2
        initial={{ opacity: 0, y: -20 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true }}
        transition={{ duration: 0.6 }}
        style={{
          fontSize: '48px',
          fontWeight: 'bold',
          textAlign: 'center',
          marginBottom: '80px',
          background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
          WebkitBackgroundClip: 'text',
          WebkitTextFillColor: 'transparent',
        }}
      >
        Why Choose Our Platform?
      </motion.h2>

      <motion.div
        variants={containerVariants}
        initial="hidden"
        whileInView="visible"
        viewport={{ once: true }}
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
          gap: '40px',
          maxWidth: '1200px',
          margin: '0 auto',
        }}
      >
        {features.map((feature, index) => (
          <motion.div
            key={index}
            variants={itemVariants}
            whileHover={{ y: -10, boxShadow: '0 20px 40px rgba(0,0,0,0.1)' }}
            style={{
              padding: '40px',
              background: '#f9fafb',
              borderRadius: '12px',
              cursor: 'pointer',
              transition: 'all 0.3s ease',
            }}
          >
            <div style={{ fontSize: '48px', marginBottom: '20px' }}>
              {feature.icon}
            </div>
            <h3 style={{ fontSize: '22px', fontWeight: 'bold', marginBottom: '12px' }}>
              {feature.title}
            </h3>
            <p style={{ color: '#666', lineHeight: '1.6' }}>
              {feature.description}
            </p>
          </motion.div>
        ))}
      </motion.div>
    </section>
  );
};

// ============================================================================
// COMPONENT: Testimonials Carousel
// ============================================================================

const TestimonialsCarousel = () => {
  const [currentIndex, setCurrentIndex] = React.useState(0);

  const testimonials = [
    {
      name: 'Sarah Chen',
      role: 'Product Designer',
      message: 'The animations are incredibly smooth and intuitive. My team loves using this platform.',
      avatar: '👩‍💼',
    },
    {
      name: 'Alex Rodriguez',
      role: 'Frontend Developer',
      message: 'Finally, a tool that makes complex animations simple. Highly recommended!',
      avatar: '👨‍💻',
    },
    {
      name: 'Emma Johnson',
      role: 'Creative Director',
      message: 'The level of customization available is amazing. We can create exactly what we envision.',
      avatar: '👩‍🎨',
    },
  ];

  const slideVariants = {
    enter: (direction: number) => ({
      x: direction > 0 ? 1000 : -1000,
      opacity: 0,
    }),
    center: {
      zIndex: 1,
      x: 0,
      opacity: 1,
    },
    exit: (direction: number) => ({
      zIndex: 0,
      x: direction < 0 ? 1000 : -1000,
      opacity: 0,
    }),
  };

  const paginate = (newDirection: number) => {
    setCurrentIndex(
      (prev) => (prev + newDirection + testimonials.length) % testimonials.length
    );
  };

  return (
    <section
      style={{
        padding: '120px 40px',
        background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
      }}
    >
      <motion.h2
        initial={{ opacity: 0 }}
        whileInView={{ opacity: 1 }}
        viewport={{ once: true }}
        style={{
          fontSize: '48px',
          fontWeight: 'bold',
          textAlign: 'center',
          marginBottom: '80px',
          color: 'white',
        }}
      >
        What Our Users Say
      </motion.h2>

      <div
        style={{
          maxWidth: '800px',
          margin: '0 auto',
          position: 'relative',
          height: '300px',
        }}
      >
        <AnimatePresence mode="wait" custom={1}>
          <motion.div
            key={currentIndex}
            custom={1}
            variants={slideVariants}
            initial="enter"
            animate="center"
            exit="exit"
            transition={{
              x: { type: 'spring', stiffness: 300, damping: 30 },
              opacity: { duration: 0.5 },
            }}
            style={{
              position: 'absolute',
              width: '100%',
            }}
          >
            <div
              style={{
                background: 'white',
                padding: '40px',
                borderRadius: '12px',
                textAlign: 'center',
              }}
            >
              <div style={{ fontSize: '64px', marginBottom: '20px' }}>
                {testimonials[currentIndex].avatar}
              </div>
              <p
                style={{
                  fontSize: '18px',
                  fontStyle: 'italic',
                  marginBottom: '20px',
                  color: '#666',
                }}
              >
                "{testimonials[currentIndex].message}"
              </p>
              <p style={{ fontWeight: 'bold', marginBottom: '4px' }}>
                {testimonials[currentIndex].name}
              </p>
              <p style={{ color: '#999' }}>
                {testimonials[currentIndex].role}
              </p>
            </div>
          </motion.div>
        </AnimatePresence>

        {/* Navigation Buttons */}
        <motion.button
          whileHover={{ scale: 1.1, x: -4 }}
          whileTap={{ scale: 0.9 }}
          onClick={() => paginate(-1)}
          style={{
            position: 'absolute',
            left: '-60px',
            top: '50%',
            y: '-50%',
            background: 'white',
            border: 'none',
            width: '50px',
            height: '50px',
            borderRadius: '50%',
            cursor: 'pointer',
            fontSize: '24px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          ←
        </motion.button>

        <motion.button
          whileHover={{ scale: 1.1, x: 4 }}
          whileTap={{ scale: 0.9 }}
          onClick={() => paginate(1)}
          style={{
            position: 'absolute',
            right: '-60px',
            top: '50%',
            y: '-50%',
            background: 'white',
            border: 'none',
            width: '50px',
            height: '50px',
            borderRadius: '50%',
            cursor: 'pointer',
            fontSize: '24px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          →
        </motion.button>

        {/* Indicators */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'center',
            gap: '12px',
            marginTop: '40px',
          }}
        >
          {testimonials.map((_, index) => (
            <motion.div
              key={index}
              animate={{
                width: index === currentIndex ? '32px' : '8px',
                background: index === currentIndex ? 'white' : 'rgba(255,255,255,0.5)',
              }}
              onClick={() => setCurrentIndex(index)}
              style={{
                height: '8px',
                borderRadius: '4px',
                cursor: 'pointer',
              }}
            />
          ))}
        </div>
      </div>
    </section>
  );
};

// ============================================================================
// COMPONENT: CTA Section
// ============================================================================

const CTASection = () => {
  const [email, setEmail] = React.useState('');
  const [submitted, setSubmitted] = React.useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitted(true);
    setTimeout(() => setSubmitted(false), 3000);
  };

  return (
    <section
      id="cta"
      style={{
        padding: '120px 40px',
        background: '#f9fafb',
        textAlign: 'center',
      }}
    >
      <motion.h2
        initial={{ opacity: 0, y: -20 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true }}
        style={{
          fontSize: '48px',
          fontWeight: 'bold',
          marginBottom: '20px',
        }}
      >
        Ready to Get Started?
      </motion.h2>

      <motion.p
        initial={{ opacity: 0 }}
        whileInView={{ opacity: 1 }}
        viewport={{ once: true }}
        transition={{ delay: 0.2 }}
        style={{
          fontSize: '18px',
          color: '#666',
          marginBottom: '40px',
          maxWidth: '600px',
          margin: '0 auto 40px',
        }}
      >
        Join thousands of designers and developers creating amazing animations
      </motion.p>

      <motion.form
        initial={{ opacity: 0, scale: 0.95 }}
        whileInView={{ opacity: 1, scale: 1 }}
        viewport={{ once: true }}
        transition={{ delay: 0.3 }}
        onSubmit={handleSubmit}
        style={{
          display: 'flex',
          gap: '12px',
          maxWidth: '500px',
          margin: '0 auto',
          flexWrap: 'wrap',
          justifyContent: 'center',
        }}
      >
        <input
          type="email"
          placeholder="your@email.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          style={{
            flex: 1,
            minWidth: '200px',
            padding: '14px 20px',
            border: '2px solid #e5e7eb',
            borderRadius: '8px',
            fontSize: '16px',
            outline: 'none',
            transition: 'border-color 0.3s ease',
          }}
          onFocus={(e) => {
            e.target.style.borderColor = '#667eea';
          }}
          onBlur={(e) => {
            e.target.style.borderColor = '#e5e7eb';
          }}
        />

        <motion.button
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          type="submit"
          style={{
            padding: '14px 40px',
            background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
            color: 'white',
            border: 'none',
            borderRadius: '8px',
            fontSize: '16px',
            fontWeight: '600',
            cursor: 'pointer',
          }}
        >
          Subscribe
        </motion.button>
      </motion.form>

      <AnimatePresence>
        {submitted && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            style={{
              marginTop: '20px',
              padding: '12px 20px',
              background: '#d1fae5',
              color: '#065f46',
              borderRadius: '8px',
              display: 'inline-block',
            }}
          >
            ✓ Thanks for subscribing!
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
};

// ============================================================================
// COMPONENT: Footer
// ============================================================================

const Footer = () => {
  const containerVariants = {
    hidden: { opacity: 0 },
    visible: {
      opacity: 1,
      transition: {
        staggerChildren: 0.05,
      },
    },
  };

  const itemVariants = {
    hidden: { opacity: 0, y: 10 },
    visible: { opacity: 1, y: 0 },
  };

  return (
    <footer
      style={{
        padding: '60px 40px',
        background: '#1f2937',
        color: 'white',
        textAlign: 'center',
      }}
    >
      <motion.div
        variants={containerVariants}
        initial="hidden"
        whileInView="visible"
        viewport={{ once: true }}
      >
        <motion.p variants={itemVariants} style={{ marginBottom: '20px' }}>
          © 2025 VOYO. All rights reserved.
        </motion.p>

        <motion.div
          variants={itemVariants}
          style={{
            display: 'flex',
            gap: '20px',
            justifyContent: 'center',
          }}
        >
          {['Twitter', 'GitHub', 'LinkedIn'].map((social) => (
            <motion.a
              key={social}
              href="#"
              whileHover={{ color: '#667eea', y: -2 }}
              style={{
                textDecoration: 'none',
                color: 'white',
                fontSize: '14px',
              }}
            >
              {social}
            </motion.a>
          ))}
        </motion.div>
      </motion.div>
    </footer>
  );
};

export default CompletePremiumLanding;
