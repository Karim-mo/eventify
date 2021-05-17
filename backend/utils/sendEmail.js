import asyncHandler from 'express-async-handler';
import nodemailer from 'nodemailer';
import colors from 'colors';

const sendEmail = asyncHandler(async (details) => {
	let transporter = nodemailer.createTransport({
		host: 'smtpout.secureserver.net',
		port: 465,
		secure: true,
		auth: {
			user: process.env.MAIL_USER,
			pass: process.env.MAIL_PW,
		},
	});

	let info = await transporter.sendMail({
		from: process.env.GMAIL_USER,
		to: details.to,
		subject: details.subject || 'Please confirm your email address ✔',
		text:
			details.text ||
			`In order to continue using Eventify, you need to click on the link below to verify your email address.
        https://eventify-global.herokuapp.com/confirmation/${details.URL}`,
	});
});

export default sendEmail;
