import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { API } from './config';
import { useToast, apiError } from './Toast';
import { isBlank, isEmail, isPhone, isGradYear } from './validation';

const LandingPage = () => {
  const toast = useToast();
  const [formData, setFormData] = useState({
    name: '', email: '', phone: '', college: '', graduationYear: '', role: ''
  });
  const [files, setFiles] = useState({
    resume: null
  });
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [errors, setErrors] = useState({});
  const [roles, setRoles] = useState([]);

  useEffect(() => {
    axios.get(`${API}/api/roles`)
      .then((res) => setRoles(res.data.filter((r) => r.active !== false).map((r) => r.title)))
      .catch(() => setRoles([]));
  }, []);

  const roleOptions = roles;

  const handleInputChange = (e) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
    setErrors((prev) => ({ ...prev, [e.target.name]: undefined }));
  };

  const handleFileChange = (e) => {
    setFiles({ ...files, [e.target.name]: e.target.files[0] });
    setErrors((prev) => ({ ...prev, resume: undefined }));
  };

  const validate = () => {
    const errs = {};
    if (isBlank(formData.name)) errs.name = 'Please enter your full name.';
    if (isBlank(formData.email)) errs.email = 'Email is required.';
    else if (!isEmail(formData.email)) errs.email = 'Enter a valid email address.';
    if (isBlank(formData.phone)) errs.phone = 'Phone number is required.';
    else if (!isPhone(formData.phone)) errs.phone = 'Enter a valid phone number.';
    if (isBlank(formData.graduationYear)) errs.graduationYear = 'Graduation year is required.';
    else if (!isGradYear(formData.graduationYear)) errs.graduationYear = 'Enter a realistic year (e.g. 2026).';
    if (isBlank(formData.college)) errs.college = 'Please enter your college.';
    if (isBlank(formData.role)) errs.role = 'Please select a role.';
    if (!files.resume) errs.resume = 'Please attach your resume (PDF).';
    else if (files.resume.type !== 'application/pdf') errs.resume = 'Resume must be a PDF file.';
    else if (files.resume.size > 5 * 1024 * 1024) errs.resume = 'Resume must be under 5 MB.';
    return errs;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const errs = validate();
    setErrors(errs);
    if (Object.keys(errs).length) {
      toast.error('Please fix the highlighted fields.');
      return;
    }
    setLoading(true);
    setMessage('');

    const data = new FormData();
    Object.keys(formData).forEach(key => data.append(key, formData[key]));
    Object.keys(files).forEach(key => {
      if(files[key]) data.append(key, files[key]);
    });

    try {
      await axios.post(`${API}/api/applications`, data, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });

      setMessage('Application submitted successfully! Check your email for a confirmation.');
      toast.success('Application submitted! Check your email for a confirmation.');
      setFormData({ name: '', email: '', phone: '', college: '', graduationYear: '', role: '' });
      setFiles({ resume: null });
      e.target.reset();
    } catch (error) {
      console.error(error);
      toast.error(apiError(error, 'Error submitting application. Please try again.'));
    }
    setLoading(false);
  };

  return (
    <>
      {/* TopNavBar */}
      <nav className="fixed top-0 left-0 w-full z-50 bg-surface/80 dark:bg-surface-dim/80 backdrop-blur-md no-border shadow-[0px_30px_60px_-15px_rgba(174,47,52,0.05)]">
        <div className="flex justify-between items-center w-full px-container-margin py-4 max-w-7xl mx-auto">
          <a className="font-display-lg text-headline-md font-extrabold text-primary dark:text-primary-fixed-dim tracking-tight" href="#">GSPL</a>
          {/* Desktop Nav */}
          <div className="hidden md:flex items-center gap-8">
            <a className="text-on-surface-variant font-medium hover:scale-105 hover:text-primary transition-all duration-300" href="#about">About Us</a>
            <a className="text-on-surface-variant font-medium hover:scale-105 hover:text-primary transition-all duration-300" href="#application">Apply</a>
          </div>
          <a href="/login" className="bg-primary-container text-on-primary-container font-label-bold text-label-bold px-6 py-3 rounded-full hover:scale-105 transition-transform duration-300 hidden md:inline-flex items-center gap-2">
            <span className="material-symbols-outlined text-base">login</span>
            Login
          </a>
          {/* Mobile Login */}
          <a href="/login" className="md:hidden bg-primary-container text-on-primary-container font-label-bold text-label-bold px-4 py-2 rounded-full inline-flex items-center gap-1">
            <span className="material-symbols-outlined text-base">login</span>
            Login
          </a>
        </div>
      </nav>

      <main className="flex-grow pt-[100px] relative z-10">
        {/* Hero Section */}
        <section className="relative min-h-[819px] flex items-center px-container-margin overflow-hidden py-section-gap">
          {/* Decorative Blobs */}
          <div className="absolute top-0 -left-4 w-72 h-72 bg-secondary-container/20 rounded-full mix-blend-multiply filter blur-2xl opacity-70 animate-blob"></div>
          <div className="absolute top-0 -right-4 w-72 h-72 bg-tertiary-container/20 rounded-full mix-blend-multiply filter blur-2xl opacity-70 animate-blob animation-delay-2000"></div>
          <div className="absolute -bottom-8 left-20 w-72 h-72 bg-primary-container/20 rounded-full mix-blend-multiply filter blur-2xl opacity-70 animate-blob animation-delay-4000"></div>
          
          <div className="max-w-7xl mx-auto w-full grid grid-cols-1 lg:grid-cols-12 gap-gutter relative z-10">
            <div className="lg:col-span-7 flex flex-col justify-center items-start space-y-stack-md z-20">
              <div className="inline-flex items-center px-4 py-2 rounded-full bg-secondary-container/10 text-secondary font-label-bold text-label-bold mb-4 border border-secondary-container/30">
                <span className="material-symbols-outlined text-sm mr-2 icon-fill">stars</span>
                Internship Program 2026
              </div>
              <h1 className="font-display-lg-mobile md:font-display-lg text-display-lg-mobile md:text-display-lg text-on-surface">
                Ready to build the <span className="text-primary relative inline-block">future
                  <svg className="absolute -bottom-2 left-0 w-full h-3 text-secondary-container" preserveAspectRatio="none" viewBox="0 0 100 20">
                    <path d="M0,10 Q50,20 100,10" fill="none" stroke="currentColor" strokeWidth="4"></path>
                  </svg>
                </span> with us?
              </h1>
              <p className="font-body-lg text-body-lg text-on-surface-variant max-w-xl">
                Join a team where your ideas have room to grow. We don't just assign tasks; we collaborate on real-world solutions.
              </p>
              <a className="mt-8 bg-primary-container text-on-primary-container font-label-bold text-label-bold px-8 py-4 rounded-full ambient-shadow hover:scale-105 active:scale-95 transition-all duration-300 inline-flex items-center group" href="#application">
                Start Application
                <span className="material-symbols-outlined ml-2 group-hover:translate-x-1 transition-transform">arrow_forward</span>
              </a>
            </div>
            
            <div className="lg:col-span-5 relative mt-12 lg:mt-0 z-10">
              {/* Asymmetrical Image Composition */}
              <div className="relative w-full aspect-[4/5] rounded-[3rem] overflow-hidden ambient-shadow transform rotate-2 hover:rotate-0 transition-transform duration-500">
                <img alt="Team collaborating" className="object-cover w-full h-full" src="https://lh3.googleusercontent.com/aida-public/AB6AXuD4hdJMUV1cnxR3chYyqsDyIGdgF68iZfwmV836C6KgKU2xUDkdkuwSIqm97R81JF1jgnTBuojdY068HbMrBJk3EuJt8SQ9YUv1jaxxLh87BB3Yr-N1Ul3AxP-vxkVQqdfMIUuMO99ZDrPCToSfpgNvLPWcRyD9Eio5pQ-8qIBITqSU-kdF-fp9eqQUlU8BXy9AFhHPGvHZ0x-yE2cgI3kvCWvLeeyy2tjXeYX0ex5zsZltBndU2hadX0INKSEU7cZJ0EXmD_k_Dqbl" />
                <div className="absolute inset-0 bg-gradient-to-t from-surface-tint/20 to-transparent"></div>
              </div>
              {/* Floating Element */}
              <div className="absolute -bottom-10 -left-10 bg-surface rounded-2xl p-6 ambient-shadow max-w-[200px] transform -rotate-3 border border-surface-variant/30 backdrop-blur-sm">
                <div className="w-12 h-12 bg-tertiary-container text-on-tertiary-container rounded-full flex items-center justify-center mb-3">
                  <span className="material-symbols-outlined icon-fill">rocket_launch</span>
                </div>
                <p className="font-label-bold text-label-bold text-on-surface">Accelerated Growth</p>
              </div>
            </div>
          </div>
        </section>

        {/* About Us Section */}
        <section className="py-section-gap px-container-margin relative" id="about">
          <div className="max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-2 gap-gutter items-center">
            <div className="space-y-stack-md">
              <div className="inline-flex items-center px-4 py-2 rounded-full bg-tertiary-container/20 text-tertiary font-label-bold text-label-bold border border-tertiary-container/30">
                <span className="material-symbols-outlined text-sm mr-2 icon-fill">groups</span>
                About Us
              </div>
              <h2 className="font-headline-lg text-headline-lg text-on-surface">Who we are at GSPL</h2>
              <p className="font-body-md text-body-md text-on-surface-variant">
                GSPL is a product-driven software studio building real solutions for real users.
                Our internship program pairs you with experienced mentors and live projects from day one — so you
                graduate from the program with shipped work, not just coursework.
              </p>
              <p className="font-body-md text-body-md text-on-surface-variant">
                We believe great products come from small, accountable teams. As an intern you'll join a team,
                own meaningful tasks, and see your contributions reach production.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-gutter">
              <div className="bg-surface rounded-[2rem] p-6 ambient-shadow border border-white/50">
                <div className="text-display-lg-mobile text-display-lg-mobile text-primary font-extrabold">50+</div>
                <p className="font-body-md text-body-md text-on-surface-variant">Projects shipped</p>
              </div>
              <div className="bg-surface rounded-[2rem] p-6 ambient-shadow border border-white/50">
                <div className="text-display-lg-mobile text-display-lg-mobile text-primary font-extrabold">20+</div>
                <p className="font-body-md text-body-md text-on-surface-variant">Interns mentored</p>
              </div>
              <div className="bg-surface rounded-[2rem] p-6 ambient-shadow border border-white/50">
                <div className="text-display-lg-mobile text-display-lg-mobile text-primary font-extrabold">1:1</div>
                <p className="font-body-md text-body-md text-on-surface-variant">Dedicated mentorship</p>
              </div>
              <div className="bg-surface rounded-[2rem] p-6 ambient-shadow border border-white/50">
                <div className="text-display-lg-mobile text-display-lg-mobile text-primary font-extrabold">100%</div>
                <p className="font-body-md text-body-md text-on-surface-variant">Real-world work</p>
              </div>
            </div>
          </div>
        </section>

        {/* Why Join Us Section */}
        <section className="py-section-gap px-container-margin relative bg-surface-container-low/50">
          <div className="max-w-7xl mx-auto">
            <div className="text-center mb-16">
              <h2 className="font-headline-lg text-headline-lg text-on-surface mb-4">Why Join Us?</h2>
              <p className="font-body-md text-body-md text-on-surface-variant max-w-2xl mx-auto">It’s more than just an internship. It’s the launchpad for your career.</p>
            </div>
            <div className="flex flex-col md:flex-row justify-center items-stretch gap-8 relative mt-20">
              <div className="bg-surface rounded-[2rem] p-8 w-full md:w-1/3 ambient-shadow transform md:-translate-y-8 hover:-translate-y-12 transition-transform duration-300 relative border border-white/50">
                <div className="absolute -top-10 left-8 w-20 h-20 bg-secondary-container rounded-full flex items-center justify-center ambient-shadow">
                  <span className="material-symbols-outlined text-on-secondary-container text-4xl icon-fill">psychology</span>
                </div>
                <h3 className="font-headline-md text-headline-md text-on-surface mt-8 mb-4">Mentorship</h3>
                <p className="font-body-md text-body-md text-on-surface-variant">Receive 1:1 guidance from industry veterans who are invested in your success.</p>
              </div>
              <div className="bg-surface rounded-[2rem] p-8 w-full md:w-1/3 ambient-shadow transform md:translate-y-4 hover:translate-y-0 transition-transform duration-300 relative border border-white/50 z-10">
                <div className="absolute -top-10 left-8 w-20 h-20 bg-primary-container rounded-full flex items-center justify-center ambient-shadow">
                  <span className="material-symbols-outlined text-on-primary-container text-4xl icon-fill">construction</span>
                </div>
                <h3 className="font-headline-md text-headline-md text-on-surface mt-8 mb-4">Real-world Projects</h3>
                <p className="font-body-md text-body-md text-on-surface-variant">No sandbox assignments here. You'll contribute to live projects impacting real users.</p>
              </div>
              <div className="bg-surface rounded-[2rem] p-8 w-full md:w-1/3 ambient-shadow transform md:-translate-y-4 hover:-translate-y-8 transition-transform duration-300 relative border border-white/50 z-20">
                <div className="absolute -top-10 left-8 w-20 h-20 bg-tertiary-container rounded-full flex items-center justify-center ambient-shadow">
                  <span className="material-symbols-outlined text-on-tertiary-container text-4xl icon-fill">trending_up</span>
                </div>
                <h3 className="font-headline-md text-headline-md text-on-surface mt-8 mb-4">Growth</h3>
                <p className="font-body-md text-body-md text-on-surface-variant">Clear pathways to full-time roles for high-performing interns. We hire to retain.</p>
              </div>
            </div>
          </div>
        </section>

        {/* Application Portal */}
        <section className="py-section-gap px-container-margin relative" id="application">
          <div className="max-w-4xl mx-auto">
            <div className="bg-surface-container-lowest rounded-[3rem] p-8 md:p-16 ambient-shadow relative overflow-hidden">
              <div className="absolute top-0 right-0 w-64 h-64 bg-secondary-container/10 rounded-bl-full pointer-events-none"></div>
              <div className="mb-12 relative z-10">
                <h2 className="font-headline-lg text-headline-lg text-on-surface mb-2">Let's get started</h2>
                <p className="font-body-md text-body-md text-on-surface-variant">Tell us a bit about yourself. No formal cover letter required, just be you.</p>
                {message && <p className="font-body-md font-bold mt-4 text-primary">{message}</p>}
              </div>
              <form onSubmit={handleSubmit} className="space-y-8 relative z-10" noValidate>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="flex flex-col gap-2">
                    <label className="font-label-bold text-label-bold text-on-surface ml-4" htmlFor="name">Full Name</label>
                    <input className={`organic-input w-full bg-surface-container-low border-none rounded-2xl px-6 py-4 font-body-md text-body-md text-on-surface placeholder-on-surface-variant/50 transition-all ${errors.name ? 'input-error' : ''}`} id="name" name="name" value={formData.name} onChange={handleInputChange} placeholder="Jane Doe" type="text" />
                    {errors.name && <span className="field-error ml-4">{errors.name}</span>}
                  </div>
                  <div className="flex flex-col gap-2">
                    <label className="font-label-bold text-label-bold text-on-surface ml-4" htmlFor="email">Email Address</label>
                    <input className={`organic-input w-full bg-surface-container-low border-none rounded-2xl px-6 py-4 font-body-md text-body-md text-on-surface placeholder-on-surface-variant/50 transition-all ${errors.email ? 'input-error' : ''}`} id="email" name="email" value={formData.email} onChange={handleInputChange} placeholder="jane@example.com" type="email" />
                    {errors.email && <span className="field-error ml-4">{errors.email}</span>}
                  </div>
                  <div className="flex flex-col gap-2">
                    <label className="font-label-bold text-label-bold text-on-surface ml-4" htmlFor="phone">Phone Number</label>
                    <input className={`organic-input w-full bg-surface-container-low border-none rounded-2xl px-6 py-4 font-body-md text-body-md text-on-surface placeholder-on-surface-variant/50 transition-all ${errors.phone ? 'input-error' : ''}`} id="phone" name="phone" value={formData.phone} onChange={handleInputChange} placeholder="(555) 123-4567" type="tel" />
                    {errors.phone && <span className="field-error ml-4">{errors.phone}</span>}
                  </div>
                  <div className="flex flex-col gap-2">
                    <label className="font-label-bold text-label-bold text-on-surface ml-4" htmlFor="grad-year">Expected Graduation Year</label>
                    <input className={`organic-input w-full bg-surface-container-low border-none rounded-2xl px-6 py-4 font-body-md text-body-md text-on-surface placeholder-on-surface-variant/50 transition-all ${errors.graduationYear ? 'input-error' : ''}`} id="grad-year" name="graduationYear" value={formData.graduationYear} onChange={handleInputChange} placeholder="2025" type="text" />
                    {errors.graduationYear && <span className="field-error ml-4">{errors.graduationYear}</span>}
                  </div>
                </div>

                <div className="flex flex-col gap-2">
                  <label className="font-label-bold text-label-bold text-on-surface ml-4" htmlFor="university">University / College</label>
                  <input className={`organic-input w-full bg-surface-container-low border-none rounded-2xl px-6 py-4 font-body-md text-body-md text-on-surface placeholder-on-surface-variant/50 transition-all ${errors.college ? 'input-error' : ''}`} id="university" name="college" value={formData.college} onChange={handleInputChange} placeholder="Where are you studying?" type="text" />
                  {errors.college && <span className="field-error ml-4">{errors.college}</span>}
                </div>

                <div className="flex flex-col gap-2">
                  <label className="font-label-bold text-label-bold text-on-surface ml-4" htmlFor="role">Role of Interest</label>
                  <div className="relative">
                    <select className={`organic-input w-full bg-surface-container-low bg-none border-none rounded-2xl px-6 py-4 font-body-md text-body-md text-on-surface appearance-none cursor-pointer focus:ring-0 ${errors.role ? 'input-error' : ''}`} id="role" name="role" value={formData.role} onChange={handleInputChange}>
                      <option disabled value="">{roleOptions.length === 0 ? 'No open roles right now' : 'Select a role...'}</option>
                      {roleOptions.map((title) => (
                        <option key={title} value={title}>{title}</option>
                      ))}
                    </select>
                    <span className="material-symbols-outlined absolute right-6 top-1/2 -translate-y-1/2 text-on-surface-variant pointer-events-none">expand_more</span>
                  </div>
                  {errors.role && <span className="field-error ml-4">{errors.role}</span>}
                </div>

                {/* Dropzone */}
                <div className="flex flex-col gap-2 mt-8">
                  <span className="font-label-bold text-label-bold text-on-surface ml-4">Upload Resume</span>
                  
                  <label htmlFor="resume" className={`border-2 border-dashed rounded-[2rem] bg-surface-container-low/50 p-10 text-center hover:bg-surface-container transition-colors cursor-pointer group flex flex-col items-center justify-center relative mt-2 ${errors.resume ? 'border-red-500 bg-red-50' : 'border-outline-variant'}`}>
                    <div className="w-16 h-16 bg-surface rounded-full flex items-center justify-center ambient-shadow mb-4 group-hover:scale-110 transition-transform">
                      <span className="material-symbols-outlined text-primary text-3xl">cloud_upload</span>
                    </div>
                    <p className="font-body-md text-body-md text-on-surface font-medium mb-1">
                      {files.resume ? files.resume.name : 'Click to select a file'}
                    </p>
                    <p className="font-label-sm text-label-sm text-on-surface-variant">Resume (PDF up to 5MB)</p>
                    <input type="file" id="resume" name="resume" accept=".pdf" onChange={handleFileChange} className="hidden" />
                  </label>
                  {errors.resume && <span className="field-error ml-4">{errors.resume}</span>}
                </div>

                <div className="pt-6">
                  <button className="w-full md:w-auto bg-primary-container text-on-primary-container font-label-bold text-label-bold px-10 py-4 rounded-full ambient-shadow hover:scale-105 active:scale-95 transition-all duration-300 text-lg flex justify-center items-center gap-2" type="submit" disabled={loading}>
                    {loading ? 'Submitting...' : 'Submit Application'}
                    <span className="material-symbols-outlined icon-fill">send</span>
                  </button>
                </div>
              </form>
            </div>
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="bg-surface-container-low dark:bg-surface-container-highest w-full mt-auto pt-16 pb-8 px-container-margin">
        <div className="max-w-7xl mx-auto">
          <div className="grid grid-cols-2 md:grid-cols-12 gap-10 pb-12">
            {/* Brand */}
            <div className="col-span-2 md:col-span-5 flex flex-col gap-4">
              <span className="font-display-lg text-headline-md font-extrabold text-primary tracking-tight">GSPL</span>
              <p className="font-body-md text-body-md text-on-surface-variant max-w-sm">
                Building the next generation of talent through hands-on internships and real-world projects. We hire to retain.
              </p>
            </div>

            {/* Explore */}
            <div className="md:col-span-2 flex flex-col gap-3">
              <h4 className="font-label-bold text-label-bold text-on-surface mb-1">Explore</h4>
              <a className="font-body-md text-body-md text-on-surface-variant hover:text-primary transition-colors duration-200" href="#about">About Us</a>
              <a className="font-body-md text-body-md text-on-surface-variant hover:text-primary transition-colors duration-200" href="#application">Apply</a>
              <a className="font-body-md text-body-md text-on-surface-variant hover:text-primary transition-colors duration-200" href="/login">Sign In</a>
            </div>

            {/* Legal */}
            <div className="md:col-span-2 flex flex-col gap-3">
              <h4 className="font-label-bold text-label-bold text-on-surface mb-1">Legal</h4>
              <a className="font-body-md text-body-md text-on-surface-variant hover:text-primary transition-colors duration-200" href="#">Privacy Policy</a>
              <a className="font-body-md text-body-md text-on-surface-variant hover:text-primary transition-colors duration-200" href="#">Terms of Service</a>
            </div>

            {/* Contact */}
            <div className="md:col-span-3 flex flex-col gap-3">
              <h4 className="font-label-bold text-label-bold text-on-surface mb-1">Get in touch</h4>
              <a className="font-body-md text-body-md text-on-surface-variant hover:text-primary transition-colors duration-200 inline-flex items-center gap-2" href="mailto:alphagspl628@gmail.com">
                <span className="material-symbols-outlined text-base">mail</span>alphagspl628@gmail.com
              </a>
            </div>
          </div>

          {/* Bottom bar */}
          <div className="border-t border-outline-variant pt-6 flex flex-col md:flex-row justify-between items-center gap-4">
            <p className="font-body-md text-body-md text-on-surface-variant">© 2026 GSPL. All rights reserved.</p>
            <p className="font-body-md text-body-md text-on-surface-variant">Built for growth.</p>
          </div>
        </div>
      </footer>
    </>
  );
};

export default LandingPage;
