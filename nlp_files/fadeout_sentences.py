import nltk
from nltk import tokenize
import sys
import html

#Example usage:
# python .\highlight_contentwords.py test.txt
#Output will be in edited_test.txt.

#Only argument should be the file name of the text file to be edited.
#The input file will not be changed. A new output file will be created.
filename = sys.argv[1]

with open(filename, "r", encoding="utf-8") as input:
	paragraphs = input.read().splitlines()

	# Don't tokenize text to maintain indexes - don't want to split "didn't" into "did" and "n't"
	# Iterate over each paragraph (so we maintain \n separators), then each word, to replace content words.
	for index_para, para in enumerate(paragraphs):
		sentences = tokenize.sent_tokenize(para)

		for index_sentence, sentence in enumerate(sentences):
			if index_sentence == 0:
				sentences[index_sentence] = "<span class=\"highlight-one\">" + sentence + "</span>"
			elif index_sentence == 1:
				sentences[index_sentence] = "<span class=\"highlight-two\">" + sentence + "</span>"
			elif index_sentence == 2:
				sentences[index_sentence] = "<span class=\"highlight-three\">" + sentence + "</span>"
			elif index_sentence == 3:
				sentences[index_sentence] = "<span class=\"highlight-four\">" + sentence + "</span>"
			else:
				sentences[index_sentence] = "<span class=\"highlight-five\">" + sentence + "</span>"

		# Join the words in the paragraph together, separated by spaces.
		# (Note: this causes an error if we want separators besides single spaces.)
		paragraphs[index_para] = ' '.join(sentences) # Look at this syntax. Python is a silly language.

	# TODO: figure out how to make this output in UTF-8 instead of ANSI, since it makes unicode characters work better

	# Output.
	output_text = '\n'.join(paragraphs)
	output_filename = "fadeout_" + filename
	with open(output_filename, "w", encoding='utf-8') as output:
		output.write(output_text)